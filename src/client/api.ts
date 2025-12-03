import type { BucketMeta, S3Folder, S3ObjectSummary } from "../types";
import { auth, authorizedFetch } from "./auth";

const toJson = async (response: Response) => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
};

export async function fetchMeta(): Promise<BucketMeta> {
  const res = await authorizedFetch("/api/meta");
  return toJson(res);
}

export async function listObjects(params: { prefix?: string; token?: string | null; pageSize?: number }) {
  const url = new URL("/api/list", window.location.origin);
  if (params.prefix) url.searchParams.set("prefix", params.prefix);
  if (params.token) url.searchParams.set("token", params.token);
  if (params.pageSize) url.searchParams.set("pageSize", String(params.pageSize));
  const res = await authorizedFetch(url);
  return toJson(res) as Promise<{ folders: S3Folder[]; objects: S3ObjectSummary[]; nextToken?: string }>;
}

export async function createFolder(body: { prefix: string; name: string }) {
  const res = await authorizedFetch("/api/folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await toJson(res);
}

export async function uploadFiles(prefix: string, files: (File & { webkitRelativePath?: string })[]) {
  const form = new FormData();
  form.append("prefix", prefix);
  const paths: string[] = [];
  files.forEach((file) => {
    const rel = (file.webkitRelativePath || file.name || "").replace(/^\/+/, "").replace(/^\.\//, "");
    paths.push(rel);
    form.append("files", file, file.name);
  });
  paths.forEach((p) => form.append("paths", p));
  const res = await authorizedFetch("/api/upload", { method: "POST", body: form });
  await toJson(res);
}

export async function deleteObject(key: string) {
  const res = await authorizedFetch("/api/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  await toJson(res);
}

export async function getLink(key: string, options?: { forceSigned?: boolean }) {
  const url = new URL("/api/link", window.location.origin);
  url.searchParams.set("key", key);
  if (options?.forceSigned) url.searchParams.set("signed", "true");
  const res = await authorizedFetch(url);
  return toJson(res) as Promise<{ url: string; kind: "public" | "signed" }>;
}

export async function login(secret: string) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  const data = await toJson(res);
  if (data?.token) auth.token = data.token;
  return data;
}
