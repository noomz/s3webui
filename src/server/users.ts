import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { PermissionKey, User } from "../types";

const defaultPermissions: Record<PermissionKey, boolean> = {
  list: true,
  createFolder: true,
  upload: true,
  delete: true,
  copyLink: true,
  copySignedUrl: true,
};

const dbPath = process.env.DB_PATH || process.env.SQLITE_PATH || "./data/s3webui.db";
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

db.run(
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    permissions TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
);

const rowToUser = (row: any): User => ({
  id: row.id,
  name: row.name,
  permissions: JSON.parse(row.permissions),
});

export function listUsers(): User[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
  return rows.map(rowToUser);
}

export function ensureAdminUser(): User {
  const existing = listUsers();
  if (existing.length) return existing[0] as User;
  const id = crypto.randomUUID();
  const name = "Admin";
  db.prepare("INSERT INTO users (id, name, permissions) VALUES (?, ?, ?)").run(
    id,
    name,
    JSON.stringify(defaultPermissions),
  );
  return { id, name, permissions: { ...defaultPermissions } };
}

export function createUser(name: string, permissions?: Record<PermissionKey, boolean>): User {
  const id = crypto.randomUUID();
  const perms = { ...defaultPermissions, ...(permissions || {}) };
  db.prepare("INSERT INTO users (id, name, permissions) VALUES (?, ?, ?)").run(
    id,
    name || "User",
    JSON.stringify(perms),
  );
  return { id, name: name || "User", permissions: perms };
}

export function updateUser(id: string, updates: Partial<Omit<User, "id">>) {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  if (!existing) throw new Error("User not found");
  const currentPerms = JSON.parse(existing.permissions || "{}");
  const nextName = updates.name ?? existing.name;
  const nextPerms =
    updates.permissions !== undefined ? updates.permissions : (currentPerms as Record<PermissionKey, boolean>);
  db.prepare("UPDATE users SET name = ?, permissions = ? WHERE id = ?").run(
    nextName,
    JSON.stringify(nextPerms),
    id,
  );
}

export function deleteUser(id: string) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export { defaultPermissions };
