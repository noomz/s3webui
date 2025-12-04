import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ListObjectsV2CommandOutput,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverConfig, objectsPublicByDefault } from "./config";
import type { BucketMeta, S3Folder, S3ObjectSummary } from "../types";

const client = new S3Client({
  region: serverConfig.region,
  endpoint: serverConfig.endpoint,
  forcePathStyle: Boolean(serverConfig.endpoint),
  credentials: {
    accessKeyId: serverConfig.accessKeyId,
    secretAccessKey: serverConfig.secretAccessKey,
    sessionToken: serverConfig.sessionToken || undefined,
  },
});

const normalizePrefix = (prefix: string) => {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
};

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

export const bucketMeta: BucketMeta = {
  bucket: serverConfig.bucket,
  region: serverConfig.region,
  defaultAcl: serverConfig.defaultObjectAcl,
  publicByDefault: objectsPublicByDefault,
};

const parseSearch = (search: string) => {
  const trimmed = search.trim().toLowerCase();
  const extDirective = trimmed.match(/^ext:\s*(.+)$/);
  if (extDirective && extDirective[1]) {
    const extensions = extDirective[1]
      .split(/[,\s]+/)
      .map((part) => part.replace(/^\./, "").trim())
      .filter(Boolean);
    if (extensions.length) {
      return { extensions };
    }
  }

  const dotExtMatch = trimmed.match(/^\*?\.([a-z0-9][a-z0-9_-]*)$/);
  if (dotExtMatch && dotExtMatch[1]) {
    return { extensions: [dotExtMatch[1]] };
  }

  return { term: trimmed.length ? trimmed : undefined };
};

const extractExtension = (key: string) => {
  const lastSlash = key.lastIndexOf("/");
  const lastDot = key.lastIndexOf(".");
  if (lastDot === -1 || lastDot < lastSlash) return "";
  return key.slice(lastDot + 1).toLowerCase();
};

export async function fetchObjects(params: { prefix?: string; token?: string | null; pageSize?: number; search?: string } = {}) {
  const normalized = normalizePrefix(params.prefix || "");
  const pageSize = params.pageSize || 50;

  // When searching, scan the full prefix to collect matches then paginate locally by offset token
  if (params.search) {
    const { term, extensions } = parseSearch(params.search);
    const matchedFolders: S3Folder[] = [];
    const matchedObjects: S3ObjectSummary[] = [];
    const seenFolderPrefixes = new Set<string>();
    let continuationToken: string | undefined;

    const offset = params.token ? Number(params.token) || 0 : 0;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: serverConfig.bucket,
          Prefix: normalized,
          Delimiter: "/",
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      response.CommonPrefixes?.forEach((item) => {
        if (!item.Prefix) return;
        if (extensions) return;
        if (term && !item.Prefix.toLowerCase().includes(term)) return;
        if (seenFolderPrefixes.has(item.Prefix)) return;
        seenFolderPrefixes.add(item.Prefix);
        const name = item.Prefix.slice(normalized.length).replace(/\/$/, "");
        if (name.length > 0) {
          matchedFolders.push({ name, prefix: item.Prefix });
        }
      });

      response.Contents?.forEach((item) => {
        if (!item.Key || item.Key === normalized) return;
        const keyLower = item.Key.toLowerCase();
        const keyExtension = extractExtension(keyLower);
        if (term && !keyLower.includes(term)) return;
        if (extensions && !extensions.some((ext) => keyExtension === ext)) return;
        matchedObjects.push({
          key: item.Key,
          size: item.Size ?? 0,
          lastModified: item.LastModified?.toISOString(),
        });
      });

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    matchedObjects.sort((a, b) => {
      const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      return bTime - aTime;
    });

    const objectsPage = matchedObjects.slice(offset, offset + pageSize);
    const nextToken = matchedObjects.length > offset + pageSize ? String(offset + pageSize) : undefined;

    return { folders: matchedFolders, objects: objectsPage, nextToken };
  }

  // Default pagination path (no search filter)
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: serverConfig.bucket,
      Prefix: normalized,
      Delimiter: "/",
      ContinuationToken: params.token || undefined,
      MaxKeys: pageSize,
    }),
  );

  const folders =
    response.CommonPrefixes?.map((item) => item.Prefix)
      .filter((p): p is string => Boolean(p))
      .map((fullPrefix) => ({
        name: fullPrefix.slice(normalized.length).replace(/\/$/, ""),
        prefix: fullPrefix,
      }))
      .filter((folder) => folder.name.length > 0) || [];

  const objects =
    response.Contents?.filter((item) => item.Key && item.Key !== normalized).map((item) => ({
      key: item.Key || "",
      size: item.Size ?? 0,
      lastModified: item.LastModified?.toISOString(),
    })) || [];

  objects.sort((a, b) => {
    const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    return bTime - aTime;
  });

  return { folders, objects, nextToken: response.NextContinuationToken };
}

export type S3ObjectDetail = {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  storageClass?: string;
};

export async function walkAllObjects(
  params: { prefix?: string } = {},
  onObject: (object: S3ObjectDetail) => void | Promise<void>,
) {
  const normalized = normalizePrefix(params.prefix || "");
  let continuationToken: ListObjectsV2CommandOutput["NextContinuationToken"];

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: serverConfig.bucket,
        Prefix: normalized,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const item of response.Contents || []) {
      if (!item.Key || item.Key === normalized) continue;
      await onObject({
        key: item.Key,
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString(),
        etag: item.ETag?.replace(/"/g, "") || undefined,
        storageClass: item.StorageClass,
      });
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
}

export async function createFolder(prefix: string, name: string) {
  const normalized = normalizePrefix(prefix);
  const cleanName = name.replace(/\/+$/g, "");
  const key = `${normalized}${cleanName}/`;
  await client.send(
    new PutObjectCommand({
      Bucket: serverConfig.bucket,
      Key: key,
      Body: new Uint8Array(),
      ACL: serverConfig.defaultObjectAcl as PutObjectCommandInput["ACL"],
    }),
  );
  return key;
}

type Uploadable = { data: ArrayBuffer; path: string; type?: string };

export async function uploadToPrefix(prefix: string, files: Uploadable[]) {
  const normalized = normalizePrefix(prefix);
  for (const file of files) {
    const key = `${normalized}${file.path}`.replace(/\/+/g, "/");
    await client.send(
      new PutObjectCommand({
        Bucket: serverConfig.bucket,
        Key: key,
        Body: new Uint8Array(file.data),
        ContentType: file.type || "application/octet-stream",
        ACL: serverConfig.defaultObjectAcl as PutObjectCommandInput["ACL"],
      }),
    );
  }
}

export async function deleteObject(key: string) {
  await client.send(
    new DeleteObjectCommand({
      Bucket: serverConfig.bucket,
      Key: key,
    }),
  );
}

export async function deleteFolder(prefix: string) {
  const normalized = normalizePrefix(prefix);
  const allKeys: string[] = [];

  // List all objects with this prefix
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: serverConfig.bucket,
        Prefix: normalized,
        ContinuationToken: continuationToken,
      }),
    );

    if (response.Contents) {
      allKeys.push(...response.Contents.map((item) => item.Key).filter((k): k is string => Boolean(k)));
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  // Delete all objects in batches of 1000 (S3 limit)
  if (allKeys.length > 0) {
    for (let i = 0; i < allKeys.length; i += 1000) {
      const batch = allKeys.slice(i, i + 1000);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: serverConfig.bucket,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
          },
        }),
      );
    }
  }
}

export function objectPublicUrl(key: string) {
  const base =
    serverConfig.publicBaseUrl ||
    `https://${serverConfig.bucket}.s3.${serverConfig.region || "us-east-1"}.amazonaws.com`;
  return `${base}/${encodeKey(key)}`;
}

export async function signedReadUrl(key: string) {
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: serverConfig.bucket,
      Key: key,
    }),
    { expiresIn: serverConfig.signedUrlTtl || 3600 },
  );
}

export async function getReadableUrl(key: string) {
  if (objectsPublicByDefault) {
    return { url: objectPublicUrl(key), kind: "public" as const };
  }
  return { url: await signedReadUrl(key), kind: "signed" as const };
}
