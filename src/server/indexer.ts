import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { walkAllObjects } from "./aws";
import { logInfo, logSuccess } from "./logger";

const dbPath = process.env.DB_PATH || process.env.SQLITE_PATH || "./data/s3webui.db";
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

db.run(
  `CREATE TABLE IF NOT EXISTS object_index (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    extension TEXT,
    size INTEGER NOT NULL,
    last_modified TEXT,
    etag TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    type TEXT NOT NULL DEFAULT ('file')
  )`,
);

db.run(
  `CREATE TABLE IF NOT EXISTS index_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_full_scan TEXT,
    last_delta_scan TEXT
  )`,
);

db.run("CREATE INDEX IF NOT EXISTS idx_object_index_name ON object_index(name)");
db.run("CREATE INDEX IF NOT EXISTS idx_object_index_extension ON object_index(extension)");

const columns = db.prepare("PRAGMA table_info(object_index)").all() as { name: string }[];
const hasType = columns.some((col) => col.name === "type");
if (!hasType) {
  db.run("ALTER TABLE object_index ADD COLUMN type TEXT NOT NULL DEFAULT ('file')");
}

const nowIso = () => new Date().toISOString();

const extractExtension = (key: string) => {
  const lastSlash = key.lastIndexOf("/");
  const lastDot = key.lastIndexOf(".");
  if (lastDot === -1 || lastDot < lastSlash) return "";
  return key.slice(lastDot + 1).toLowerCase();
};

const basename = (key: string) => key.split("/").filter(Boolean).pop() || key;
const folderPrefixesForKey = (key: string) => {
  const parts = key.split("/").filter(Boolean);
  const prefixes: { key: string; name: string }[] = [];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts[i] || "";
    if (!name) continue;
    acc += `${name}/`;
    prefixes.push({ key: acc, name });
  }
  return prefixes;
};

type IndexState = { last_full_scan?: string | null; last_delta_scan?: string | null };

const getState = (): IndexState => {
  const row = db.prepare("SELECT last_full_scan, last_delta_scan FROM index_state WHERE id = 1").get() as
    | IndexState
    | undefined;
  return row || { last_full_scan: null, last_delta_scan: null };
};

const updateState = (updates: Partial<IndexState>) => {
  const current = getState();
  const next = { ...current, ...updates };
  const lastFull = next.last_full_scan || null;
  const lastDelta = next.last_delta_scan || null;
  db.prepare(
    `INSERT INTO index_state (id, last_full_scan, last_delta_scan) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_full_scan = excluded.last_full_scan, last_delta_scan = excluded.last_delta_scan`,
  ).run(lastFull, lastDelta);
};

const upsertObject = db.prepare(
  `INSERT INTO object_index (key, name, extension, size, last_modified, etag, updated_at, type)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET
     name = excluded.name,
     extension = excluded.extension,
     size = excluded.size,
     last_modified = excluded.last_modified,
     etag = excluded.etag,
     type = excluded.type,
     updated_at = excluded.updated_at`,
);

const getObject = db.prepare("SELECT size, last_modified, etag, type FROM object_index WHERE key = ?");
const deleteObjectStmt = db.prepare("DELETE FROM object_index WHERE key = ?");

export const getIndexStatus = () => {
  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM object_index WHERE type = 'file'")
    .get() as { count: number } | undefined;
  const state = getState();
  return {
    objectCount: countRow?.count || 0,
    lastFullScan: state.last_full_scan || null,
    lastDeltaScan: state.last_delta_scan || null,
  };
};

export async function rebuildIndex() {
  db.run("DELETE FROM object_index");
  let indexed = 0;
  const seenKeys = new Set<string>();
  const seenFolders = new Set<string>();

  logInfo("[indexer] Starting full rebuild of bucket index…");
  await walkAllObjects({ prefix: "" }, async (obj) => {
    const ext = extractExtension(obj.key);
    const folders = folderPrefixesForKey(obj.key);
    folders.forEach((folder) => {
      if (seenFolders.has(folder.key)) return;
      upsertObject.run(folder.key, folder.name, null, 0, null, null, nowIso(), "folder");
      seenFolders.add(folder.key);
      seenKeys.add(folder.key);
    });

    upsertObject.run(
      obj.key,
      basename(obj.key),
      ext || null,
      obj.size,
      obj.lastModified || null,
      obj.etag || null,
      nowIso(),
      "file",
    );
    seenKeys.add(obj.key);
    indexed += 1;
    if (indexed % 2000 === 0) {
      logInfo(`[indexer] Processed ${indexed} objects so far…`);
    }
  });

  const now = new Date().toISOString();
  updateState({ last_full_scan: now, last_delta_scan: now });
  const fileCount = db
    .prepare("SELECT COUNT(*) as count FROM object_index WHERE type = 'file'")
    .get() as { count: number } | undefined;
  const folderCount = db
    .prepare("SELECT COUNT(*) as count FROM object_index WHERE type = 'folder'")
    .get() as { count: number } | undefined;

  logSuccess(
    `[indexer] Full rebuild complete. Processed ${indexed} objects → stored ${fileCount?.count ?? 0} files and ${folderCount?.count ?? 0} folders.`,
  );
  return { indexed: fileCount?.count ?? 0, folders: folderCount?.count ?? 0 };
}

export async function refreshIndex() {
  const seenKeys = new Set<string>();
  const seenFolders = new Set<string>();
  let added = 0;
  let updated = 0;

  logInfo("[indexer] Starting delta refresh…");
  await walkAllObjects({ prefix: "" }, async (obj) => {
    const ext = extractExtension(obj.key);
    const folders = folderPrefixesForKey(obj.key);
    folders.forEach((folder) => {
      if (seenFolders.has(folder.key)) return;
      const existingFolder = getObject.get(folder.key) as
        | { size: number; last_modified?: string | null; etag?: string | null; type?: string }
        | undefined;
      const needsFolder =
        !existingFolder || existingFolder.type !== "folder" || existingFolder.size !== 0 || existingFolder.last_modified !== null;
      if (needsFolder) {
        upsertObject.run(folder.key, folder.name, null, 0, null, null, nowIso(), "folder");
        if (!existingFolder) {
          added += 1;
        } else {
          updated += 1;
        }
      }
      seenFolders.add(folder.key);
      seenKeys.add(folder.key);
    });

    const existing = getObject.get(obj.key) as
      | { size: number; last_modified?: string | null; etag?: string | null; type?: string }
      | undefined;
    const lastModified = obj.lastModified || null;
    const etag = obj.etag || null;
    const needsUpdate =
      !existing ||
      existing.type !== "file" ||
      existing.size !== obj.size ||
      existing.last_modified !== lastModified ||
      existing.etag !== etag;
    if (!existing) {
      added += 1;
    } else if (needsUpdate) {
      updated += 1;
    }
    if (needsUpdate) {
      upsertObject.run(obj.key, basename(obj.key), ext || null, obj.size, lastModified, etag, nowIso(), "file");
    }
    seenKeys.add(obj.key);
  });

  let removed = 0;
  const allKeys = db.prepare("SELECT key FROM object_index").all() as { key: string }[];
  for (const row of allKeys) {
    if (!seenKeys.has(row.key)) {
      deleteObjectStmt.run(row.key);
      removed += 1;
    }
  }

  const now = new Date().toISOString();
  updateState({ last_delta_scan: now });

  const fileCount = db
    .prepare("SELECT COUNT(*) as count FROM object_index WHERE type = 'file'")
    .get() as { count: number } | undefined;
  const folderCount = db
    .prepare("SELECT COUNT(*) as count FROM object_index WHERE type = 'folder'")
    .get() as { count: number } | undefined;

  logSuccess(
    `[indexer] Delta refresh complete. Added ${added}, updated ${updated}, removed ${removed}. Indexed now ${fileCount?.count ?? 0} files and ${folderCount?.count ?? 0} folders.`,
  );
  return {
    added,
    updated,
    removed,
    files: fileCount?.count ?? 0,
    folders: folderCount?.count ?? 0,
  };
}

export type IndexStatus = ReturnType<typeof getIndexStatus>;

export type IndexedObjectRow = {
  key: string;
  name: string;
  extension: string | null;
  size: number;
  lastModified: string | null;
  updatedAt: string;
  type: "file" | "folder";
};

export const getRecentIndexedObjects = (limit = 20): IndexedObjectRow[] => {
  const rows = db
    .prepare(
      `SELECT key, name, extension, size, last_modified as lastModified, updated_at as updatedAt, type
       FROM object_index
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as any[];
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    extension: row.extension || null,
    size: Number(row.size || 0),
    lastModified: row.lastModified ? (row.lastModified.endsWith("Z") ? row.lastModified : `${row.lastModified}Z`) : null,
    updatedAt: row.updatedAt ? (row.updatedAt.endsWith("Z") ? row.updatedAt : `${row.updatedAt}Z`) : nowIso(),
    type: row.type === "folder" ? "folder" : "file",
  }));
};

export const searchIndexedObjects = (params: { search?: string; limit?: number; offset?: number }) => {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (params.search) {
    const needle = params.search.toLowerCase().trim();
    if (needle.length) {
      conditions.push("(lower(name) LIKE ? OR lower(key) LIKE ? OR lower(extension) LIKE ?)");
      const like = `%${needle}%`;
      bindings.push(like, like, like);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT key, name, extension, size, last_modified as lastModified, updated_at as updatedAt, type
       FROM object_index
       ${where}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...bindings, limit, offset) as any[];

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM object_index ${where}`)
    .get(...bindings) as { count: number } | undefined;

  const items = rows.map((row) => ({
    key: row.key,
    name: row.name,
    extension: row.extension || null,
    size: Number(row.size || 0),
    lastModified: row.lastModified ? (row.lastModified.endsWith("Z") ? row.lastModified : `${row.lastModified}Z`) : null,
    updatedAt: row.updatedAt ? (row.updatedAt.endsWith("Z") ? row.updatedAt : `${row.updatedAt}Z`) : nowIso(),
    type: row.type === "folder" ? "folder" : "file",
  }));

  return { items, total: countRow?.count || 0 };
};
