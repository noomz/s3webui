import { useEffect, useMemo, useState } from "react";
import type { PermissionKey, User } from "../types";

const USERS_KEY = "s3webui:users";
const CURRENT_USER_KEY = "s3webui:currentUser";

const defaultPermissions: Record<PermissionKey, boolean> = {
  list: true,
  createFolder: true,
  upload: true,
  delete: true,
  copyLink: true,
  copySignedUrl: true,
};

const adminUser: User = {
  id: "admin",
  name: "Admin",
  permissions: { ...defaultPermissions },
};

const loadUsers = (): User[] => {
  if (typeof window === "undefined") return [adminUser];
  const stored = localStorage.getItem(USERS_KEY);
  if (!stored) return [adminUser];
  try {
    const parsed: User[] = JSON.parse(stored);
    return parsed.length ? parsed : [adminUser];
  } catch {
    return [adminUser];
  }
};

const loadCurrentUserId = (fallback: User[]): string => {
  if (typeof window === "undefined") return fallback[0]?.id || "admin";
  const stored = localStorage.getItem(CURRENT_USER_KEY);
  if (stored && fallback.some((u) => u.id === stored)) return stored;
  return fallback[0]?.id || "admin";
};

export function useUsers() {
  const [users, setUsers] = useState<User[]>(() => loadUsers());
  const [currentUserId, setCurrentUserId] = useState<string>(() => loadCurrentUserId(users));

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CURRENT_USER_KEY, currentUserId);
  }, [currentUserId]);

  const currentUser = useMemo(() => users.find((u) => u.id === currentUserId), [users, currentUserId]);

  const addUser = (name: string, permissions = defaultPermissions) => {
    const id = crypto.randomUUID();
    const newUser: User = { id, name: name.trim() || "User", permissions: { ...defaultPermissions, ...permissions } };
    setUsers((prev) => [...prev, newUser]);
    setCurrentUserId(id);
  };

  const updateUser = (id: string, updates: Partial<User>) => {
    setUsers((prev) => prev.map((user) => (user.id === id ? { ...user, ...updates } : user)));
  };

  const updatePermissions = (id: string, permissions: Record<PermissionKey, boolean>) => {
    setUsers((prev) => prev.map((user) => (user.id === id ? { ...user, permissions } : user)));
  };

  const removeUser = (id: string) => {
    setUsers((prev) => prev.filter((user) => user.id !== id));
    setCurrentUserId((prev) => {
      if (prev === id) {
        const next = users.find((user) => user.id !== id);
        return next ? next.id : adminUser.id;
      }
      return prev;
    });
  };

  return {
    users,
    currentUser,
    currentUserId,
    setCurrentUserId,
    addUser,
    updateUser,
    updatePermissions,
    removeUser,
  };
}
