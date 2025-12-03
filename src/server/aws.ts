import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverConfig, objectsPublicByDefault } from "./config";
import type { BucketMeta, S3Folder, S3ObjectSummary } from "../types";

const client = new S3Client({
  region: serverConfig.region,
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

export async function fetchObjects(params: { prefix?: string; token?: string | null; pageSize?: number } = {}) {
  const normalized = normalizePrefix(params.prefix || "");
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: serverConfig.bucket,
      Prefix: normalized,
      Delimiter: "/",
      ContinuationToken: params.token || undefined,
      MaxKeys: params.pageSize || 50,
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

  return { folders, objects, nextToken: response.NextContinuationToken };
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
