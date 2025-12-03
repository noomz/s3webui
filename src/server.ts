import { serve } from "bun";
import path from "node:path";
import jwt from "jsonwebtoken";
import {
  bucketMeta,
  createFolder,
  deleteFolder,
  deleteObject,
  fetchObjects,
  getReadableUrl,
  signedReadUrl,
  uploadToPrefix,
} from "./server/aws";
import { objectsPublicByDefault, serverConfig } from "./server/config";
import {
  createUser,
  deleteUser as removeUser,
  ensureAdminUser,
  listUsers,
  updateUser as editUser,
} from "./server/users";

const distDir = path.resolve(import.meta.dir, "../dist");
const indexHtml = path.join(distDir, "index.html");

const sendJson = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const notFound = new Response("Not found", { status: 404 });
const unauthorized = new Response("Unauthorized", { status: 401 });

const cleanPath = (p: string) => {
  const normalized = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
  return normalized;
};

const verifyAuth = (req: Request) => {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  try {
    return jwt.verify(token, serverConfig.jwtSecret) as jwt.JwtPayload;
  } catch {
    return null;
  }
};

async function handleApi(req: Request) {
  const url = new URL(req.url);
  const { pathname } = url;

  try {
    ensureAdminUser();

    if (pathname !== "/api/login") {
      const payload = verifyAuth(req);
      if (!payload) return unauthorized;
    }

    if (pathname === "/api/login" && req.method === "POST") {
      const body = await req.json();
      if (!body?.secret || body.secret !== serverConfig.adminSecret) {
        return unauthorized;
      }
      const token = jwt.sign({ sub: "admin" }, serverConfig.jwtSecret, { expiresIn: "7d" });
      return sendJson({ token });
    }

    if (pathname === "/api/meta") {
      return sendJson({
        bucket: bucketMeta.bucket,
        region: bucketMeta.region,
        defaultAcl: bucketMeta.defaultAcl,
        publicByDefault: bucketMeta.publicByDefault,
      });
    }

    if (pathname === "/api/list" && req.method === "GET") {
      const prefix = url.searchParams.get("prefix") || "";
      const token = url.searchParams.get("token");
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const search = url.searchParams.get("search") || undefined;
      const data = await fetchObjects({ prefix, token, pageSize, search });
      return sendJson(data);
    }

    if (pathname === "/api/users" && req.method === "GET") {
      return sendJson(listUsers());
    }

    if (pathname === "/api/users" && req.method === "POST") {
      const body = await req.json();
      const user = createUser(body?.name || "User", body?.permissions);
      return sendJson(user, { status: 201 });
    }

    if (pathname.startsWith("/api/users/") && req.method === "PUT") {
      const id = pathname.split("/").pop() || "";
      const body = await req.json();
      editUser(id, body || {});
      return sendJson({ ok: true });
    }

    if (pathname.startsWith("/api/users/") && req.method === "DELETE") {
      const id = pathname.split("/").pop() || "";
      removeUser(id);
      return sendJson({ ok: true });
    }

    if (pathname === "/api/folder" && req.method === "POST") {
      const body = await req.json();
      if (!body?.name) return new Response("Folder name required", { status: 400 });
      await createFolder(body.prefix || "", body.name);
      return sendJson({ ok: true });
    }

    if (pathname === "/api/upload" && req.method === "POST") {
      const form = await req.formData();
      const prefix = String(form.get("prefix") || "");
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      const paths = form.getAll("paths").map((p) => String(p || ""));
      if (!files.length) return new Response("No files", { status: 400 });
      const uploads = await Promise.all(
        files.map(async (file, index) => ({
          data: await file.arrayBuffer(),
          type: file.type,
          path: paths[index] || file.name,
        })),
      );
      await uploadToPrefix(prefix, uploads);
      return sendJson({ ok: true });
    }

    if (pathname === "/api/delete" && req.method === "POST") {
      const body = await req.json();
      if (!body?.key) return new Response("Key required", { status: 400 });
      // If key ends with /, it's a folder - delete recursively
      if (body.key.endsWith("/")) {
        await deleteFolder(body.key);
      } else {
        await deleteObject(body.key);
      }
      return sendJson({ ok: true });
    }

    if (pathname === "/api/link" && req.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) return new Response("Key required", { status: 400 });
      const forceSigned = url.searchParams.get("signed") === "true";
      const link = forceSigned ? { url: await signedReadUrl(key), kind: "signed" as const } : await getReadableUrl(key);
      return sendJson(link);
    }
  } catch (err) {
    console.error(err);
    return new Response(err instanceof Error ? err.message : "Server error", { status: 500 });
  }

  return notFound;
}

const server = serve({
  port: Number(process.env.PORT || 5173),
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req);
    }

    const staticPath = cleanPath(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.join(distDir, staticPath);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    const indexFile = Bun.file(indexHtml);
    if (await indexFile.exists()) {
      return new Response(indexFile, { headers: { "Content-Type": "text/html" } });
    }
    return notFound;
  },
});

console.log(
  `S3 Web Admin server running on http://localhost:${server.port} → bucket ${serverConfig.bucket} (${serverConfig.region}) public default: ${objectsPublicByDefault}`,
);
