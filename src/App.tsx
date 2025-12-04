import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDownUp,
  FileText,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileType,
  Image,
  Music2,
  Video,
  Folder,
  Eye,
  FolderOpen,
  Home,
  Link2,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import {
  createFolder,
  deleteObject,
  fetchMeta,
  getLink,
  listObjects,
  uploadFiles,
  fetchUsers,
  createUserApi,
  updateUserApi,
  deleteUserApi,
} from "./client/api";
import { UserManagement } from "./components/UserManagement";
import { IndexingPanel } from "./components/IndexingPanel";
import { Login } from "./components/Login";
import type { BucketMeta, PermissionKey, S3Folder, S3ObjectSummary, User } from "./types";
import { auth } from "./client/auth";

const readableSize = (size: number) => {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** exponent;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
};

const prefixBreadcrumbs = (prefix: string) => {
  const parts = prefix.split("/").filter(Boolean);
  const crumbs = [];
  let acc = "";
  for (const part of parts) {
    acc = `${acc}${part}/`;
    crumbs.push({ label: part, value: acc });
  }
  return crumbs;
};

const copyToClipboard = async (text: string) => {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};

const readPrefixFromUrl = () => {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  return url.searchParams.get("prefix") || "";
};

const toastDuration = 4200;

const fileIconForKey = (key: string) => {
  const ext = (key.split(".").pop() || "").toLowerCase();
  if (!ext || !key.includes(".")) return FileText;
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"].includes(ext)) return Image;
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return Video;
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) return Music2;
  if (["zip", "rar", "7z", "tar", "gz", "tgz"].includes(ext)) return FileArchive;
  if (["xls", "xlsx", "csv", "ods", "numbers"].includes(ext)) return FileSpreadsheet;
  if (["pdf", "doc", "docx", "pages", "odt", "rtf"].includes(ext)) return FileType;
  if (["js", "ts", "tsx", "jsx", "json", "yml", "yaml", "html", "css", "scss", "md"].includes(ext)) return FileCode;
  return FileText;
};

export function App() {
  const [meta, setMeta] = useState<BucketMeta | null>(null);
  const [path, setPath] = useState(() => (typeof window !== "undefined" ? window.location.pathname : "/"));
  const [prefix, setPrefix] = useState(readPrefixFromUrl());
  const [folders, setFolders] = useState<S3Folder[]>([]);
  const [objects, setObjects] = useState<S3ObjectSummary[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [pageTokens, setPageTokens] = useState<string[]>([""]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastModifiedSort, setLastModifiedSort] = useState<"asc" | "desc">("desc");
  const [isAuthed, setIsAuthed] = useState(() => Boolean(auth.token));
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [toasts, setToasts] = useState<{ id: number; text: string; type: "info" | "success" | "error" }[]>([]);
  const [adminTab, setAdminTab] = useState<"users" | "indexing">("users");
  const isUnauthorized = (err: unknown) => err instanceof Error && /unauthorized/i.test(err.message || "");

  const addToast = useCallback(
    (text: string, type: "info" | "success" | "error" = "info") => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, text, type }]);
      const timer = window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, toastDuration);
      toastTimerRef.current[id] = timer;
    },
    [],
  );

  useEffect(() => {
    return () => {
      Object.values(toastTimerRef.current).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const syncCurrentUser = (list: User[]) => {
    if (!list.length) {
      setUsers([]);
      setCurrentUserId("");
      return;
    }
    const [firstUser] = list as [User, ...User[]];
    setUsers(list);
    if (!currentUserId || !list.find((u) => u.id === currentUserId)) {
      setCurrentUserId(firstUser.id);
    }
  };

  const loadUsers = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const fetched = (await fetchUsers()) as User[];
      syncCurrentUser(fetched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load users";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  }, [isAuthed, currentUserId, addToast]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<Record<number, number>>({});

  const isAdminRoute = path.startsWith("/admin");

  const permissions = useMemo(() => {
    const currentUser = users.find((u) => u.id === currentUserId);
    return (
      currentUser?.permissions || {
        list: false,
        createFolder: false,
        upload: false,
        delete: false,
        copyLink: false,
        copySignedUrl: false,
      }
    );
  }, [users, currentUserId]);

  const loadObjects = useCallback(async () => {
    if (!permissions.list) return;
    setLoading(true);
    setNextToken(undefined);
    try {
      const data = await listObjects({
        prefix,
        token: pageTokens[pageIndex] || undefined,
        pageSize: 50,
        search: debouncedSearch || undefined,
      });
      setFolders(data.folders);
      setObjects(data.objects);
      setNextToken(data.nextToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to list objects";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    } finally {
      setLoading(false);
    }
  }, [permissions.list, prefix, pageIndex, pageTokens, debouncedSearch, addToast]);

  useEffect(() => {
    if (!isAuthed) return;
    void (async () => {
      try {
        const info = await fetchMeta();
        setMeta(info);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to load bucket metadata";
        addToast(msg, "error");
        if (isUnauthorized(err)) logout();
      }
    })();
  }, [isAuthed, addToast]);

  useEffect(() => {
    if (!isAuthed) return;
    void loadUsers();
  }, [isAuthed, loadUsers]);

  useEffect(() => {
    // Reset pagination when search query changes
    setPageIndex(0);
    setPageTokens([""]);
  }, [searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 1000);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [prefix, pageIndex, debouncedSearch]);

  useEffect(() => {
    if (!meta || !isAuthed) return;
    void loadObjects();
  }, [loadObjects, meta, isAuthed]);

  useEffect(() => {
    const handler = () => {
      setPath(window.location.pathname);
      setPrefix(readPrefixFromUrl());
      setPageTokens([""]);
      setPageIndex(0);
      setNextToken(undefined);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  useEffect(() => {
    setSelectedKeys((prev) => {
      const keysOnPage = new Set(objects.map((obj) => obj.key));
      const next = new Set(Array.from(prev).filter((key) => keysOnPage.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [objects]);

  useEffect(() => {
    const checkbox = selectAllRef.current;
    if (!checkbox) return;
    const total = objects.length;
    const selected = selectedKeys.size;
    checkbox.indeterminate = selected > 0 && selected < total;
  }, [objects.length, selectedKeys]);

  const navigate = (nextPath: string) => {
    if (typeof window === "undefined") return;
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  const changePrefix = (nextPrefix: string) => {
    setPrefix(nextPrefix);
    setPageTokens([""]);
    setPageIndex(0);
    setNextToken(undefined);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.pathname = "/";
      if (nextPrefix) {
        url.searchParams.set("prefix", nextPrefix);
      } else {
        url.searchParams.delete("prefix");
      }
      window.history.pushState({ prefix: nextPrefix }, "", url);
      setPath(url.pathname);
    }
  };

  const logout = () => {
    auth.clear();
    setIsAuthed(false);
    setMeta(null);
    setFolders([]);
    setObjects([]);
    setPrefix("");
    setUsers([]);
    setCurrentUserId("");
  };

  const goUp = () => {
    if (!prefix) return;
    const parts = prefix.split("/").filter(Boolean);
    parts.pop();
    const nextPrefix = parts.length ? `${parts.join("/")}/` : "";
    changePrefix(nextPrefix);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await createFolder({ prefix, name: newFolderName.trim() });
      setNewFolderName("");
      addToast(`Created ${newFolderName}`, "success");
      void loadObjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to create folder";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      addToast(`Uploading ${files.length} item(s)...`, "info");
      try {
        await uploadFiles(
          prefix,
          Array.from(files).map((file) => file as File & { webkitRelativePath?: string }),
        );
        addToast("Upload complete", "success");
        await loadObjects();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        addToast(msg, "error");
        if (isUnauthorized(err)) logout();
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [prefix, loadObjects, isUnauthorized, addToast],
  );

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete ${key}?`)) return;
    try {
      await deleteObject(key);
      addToast(`Deleted ${key}`, "success");
      void loadObjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to delete object";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const handleBulkDelete = async () => {
    const keys = Array.from(selectedKeys);
    if (!keys.length) return;
    if (!can("delete")) {
      addToast("You do not have permission to delete items", "error");
      return;
    }
    if (
      !confirm(
        `Delete ${keys.length} item(s)? This will permanently remove the selected files/folders from the bucket.`,
      )
    ) {
      return;
    }

    addToast(`Deleting ${keys.length} item(s)...`, "info");
    let deleted = 0;
    for (const key of keys) {
      try {
        await deleteObject(key);
        deleted += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed";
        addToast(`Failed to delete ${key}: ${msg}`, "error");
      }
    }

    addToast(`Deleted ${deleted} of ${keys.length} item(s)`, deleted === keys.length ? "success" : "error");
    setSelectedKeys(new Set());
    void loadObjects();
  };

  const fetchAllObjectsForCopy = useCallback(async () => {
    const all: S3ObjectSummary[] = [];
    let token: string | undefined;
    do {
      const data = await listObjects({
        prefix,
        token,
        pageSize: 200,
        search: searchQuery || undefined,
      });
      all.push(...data.objects);
      token = data.nextToken;
    } while (token);
    return all;
  }, [prefix, searchQuery]);

  const handleCopyLink = async (key: string) => {
    try {
      const result = await getLink(key);
      await copyToClipboard(result.url);
      addToast(`${result.kind === "public" ? "Public" : "Signed"} link copied`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to create link";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const handleBulkCopyLinks = async () => {
    if (!can("copyLink")) return;
    const sortKeysByLastModified = (keys: string[], source: S3ObjectSummary[]) => {
      const times = new Map(source.map((obj) => [obj.key, obj.lastModified ? new Date(obj.lastModified).getTime() : 0]));
      return [...keys].sort((a, b) => {
        const aTime = times.get(a) ?? 0;
        const bTime = times.get(b) ?? 0;
        return lastModifiedSort === "desc" ? bTime - aTime : aTime - bTime;
      });
    };

    let keys: string[] = [];
    if (selectedKeys.size > 0) {
      const selectedObjects = sortedObjects.filter((obj) => selectedKeys.has(obj.key));
      keys = sortKeysByLastModified(Array.from(selectedKeys), selectedObjects);
    } else {
      const allObjects = await fetchAllObjectsForCopy();
      keys = sortKeysByLastModified(
        allObjects.map((obj) => obj.key),
        allObjects,
      );
    }
    if (!keys.length) {
      addToast("No files to copy from this folder", "error");
      return;
    }
    addToast(`Copying ${keys.length} link(s)...`, "info");
    try {
      const links = await Promise.all(
        keys.map(async (key) => {
          const result = await getLink(key);
          return result.url;
        }),
      );
      await copyToClipboard(links.join("\n"));
      addToast(`Copied ${keys.length} link(s) ${selectedKeys.size ? "from selection" : "from current folder"}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to copy links";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const sortedObjects = useMemo(() => {
    const list = [...objects];
    list.sort((a, b) => {
      const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      return lastModifiedSort === "desc" ? bTime - aTime : aTime - bTime;
    });
    return list;
  }, [objects, lastModifiedSort]);

  const toggleLastModifiedSort = () => {
    setLastModifiedSort((prev) => (prev === "desc" ? "asc" : "desc"));
  };

  const handlePreview = async (key: string) => {
    try {
      const result = await getLink(key);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to open preview";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  useEffect(() => {
    const zone = dropZoneRef.current;
    if (!zone) return;
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.add("dropping");
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("dropping");
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("dropping");
      const items = event.dataTransfer?.files;
      void handleUpload(items || null);
    };
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);
    return () => {
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDrop);
    };
  }, [handleUpload]);

  const handleAddUser = async (name: string) => {
    try {
      const created = await createUserApi(name);
      await loadUsers();
      if (created?.id) setCurrentUserId(created.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to add user";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const handleUpdateUserMeta = async (id: string, updates: Partial<User>) => {
    try {
      await updateUserApi(id, updates);
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to update user";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const handleUpdatePermissions = async (id: string, perms: Record<PermissionKey, boolean>) => {
    try {
      await updateUserApi(id, { permissions: perms });
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to update permissions";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const handleRemoveUser = async (id: string) => {
    try {
      await deleteUserApi(id);
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to remove user";
      addToast(msg, "error");
      if (isUnauthorized(err)) logout();
    }
  };

  const can = (permission: PermissionKey) => Boolean(permissions[permission]);

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllOnPage = () => {
    if (!objects.length) return;
    const allKeys = objects.map((obj) => obj.key);
    const shouldSelectAll = selectedKeys.size !== allKeys.length;
    setSelectedKeys(shouldSelectAll ? new Set(allKeys) : new Set());
  };

  if (!isAuthed) {
    return (
      <div className="page">
        <header className="topbar">
          <div>
            <p className="eyebrow">S3 Web Admin</p>
            <h1>Authentication required</h1>
            <p className="muted">Enter the admin secret to continue</p>
          </div>
        </header>
        <Login onSuccess={() => setIsAuthed(true)} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">S3 Web Admin</p>
          <h1>{meta?.bucket || "Bucket not configured"}</h1>
          <p className="muted">
            {meta ? (
              <>
                Region {meta.region} · Default ACL {meta.defaultAcl} ·{" "}
                {meta.publicByDefault ? "Objects public by default" : "Objects private by default"}
              </>
            ) : (
              "Loading bucket metadata…"
            )}
          </p>
        </div>
        <div className="status">
          <div className="status-actions">
            <button className="ghost" onClick={logout}>
              Logout
            </button>
            <button className="ghost" onClick={() => navigate(isAdminRoute ? "/" : "/admin")}>
              {isAdminRoute ? "Go to bucket" : "Admin"}
            </button>
          </div>
        </div>
      </header>

      {!isAdminRoute && (
        <section className="panel dropzone" ref={dropZoneRef}>
          <header className="panel-header">
            <div className="path-row">
              <button className="ghost" onClick={goUp} disabled={!prefix} title="Up one level">
                <ArrowUp size={16} /> Up
              </button>
              <div className="breadcrumbs">
                <button className={!prefix ? "active crumb" : "crumb"} onClick={() => changePrefix("")} title="Root">
                  <Home size={16} aria-hidden />
                  <span>Root</span>
                </button>
                {prefixBreadcrumbs(prefix).map((crumb) => (
                  <button
                    key={crumb.value}
                    className={crumb.value === prefix ? "active crumb" : "crumb"}
                    onClick={() => changePrefix(crumb.value)}
                    title={crumb.value}
                  >
                    <FolderOpen size={14} /> {crumb.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="actions">
              <button onClick={() => loadObjects()} disabled={!can("list") || loading} title="Refresh">
                <RefreshCcw size={16} /> Refresh
              </button>
              <div className="pagination">
                <button
                  className="ghost"
                  onClick={() => {
                    if (pageIndex === 0) return;
                    setPageIndex((i) => Math.max(0, i - 1));
                  }}
                  disabled={pageIndex === 0}
                  title="Previous page"
                >
                  <ArrowLeft size={16} /> Prev
                </button>
                <span className="page-indicator">
                  Page {pageIndex + 1}
                  {nextToken ? "" : " (end)"}
                </span>
                <button
                  className="ghost"
                  onClick={() => {
                    if (!nextToken) return;
                    setPageTokens((tokens) => {
                      const copy = tokens.slice(0, pageIndex + 1);
                      copy.push(nextToken);
                      return copy;
                    });
                    setPageIndex((i) => i + 1);
                  }}
                  disabled={!nextToken}
                  title="Next page"
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
              <div className="upload-group">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(event) => handleUpload(event.target.files)}
                  hidden
                />
                <button onClick={() => fileInputRef.current?.click()} disabled={!can("upload")} title="Upload files">
                  <Upload size={16} /> Upload files
                </button>
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  // @ts-expect-error - webkitdirectory is supported at runtime
                  webkitdirectory="true"
                  onChange={(event) => handleUpload(event.target.files)}
                  hidden
                />
                <button onClick={() => folderInputRef.current?.click()} disabled={!can("upload")} title="Upload folder">
                  <UploadCloud size={16} /> Upload folder
                </button>
              </div>
              <div className="create-folder">
                <input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="Folder name"
                  disabled={!can("createFolder")}
                />
                <button
                  className="ghost"
                  onClick={handleCreateFolder}
                  disabled={!can("createFolder") || !newFolderName.trim()}
                  title="Create folder"
                >
                  <Plus size={16} /> Create
                </button>
              </div>
            </div>
          </header>

          <div className="search-row" style={{ padding: "12px 18px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <Search size={16} style={{ color: "#6b7280" }} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name or extension (e.g. report, .png, ext:pdf)"
                title="Search by name, or filter by extension with .ext or ext:ext"
                style={{ flex: 1, padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: "4px" }}
              />
              {searchQuery && (
                <button className="ghost" onClick={() => setSearchQuery("")} title="Clear search">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="bulk-row">
            <div className="bulk-summary">
              {selectedKeys.size
                ? `Selected ${selectedKeys.size} item(s)`
                : `No selection — action applies to ${objects.length ? "all files in this view" : "none"}`}
            </div>
            <div className="bulk-actions">
              <button
                onClick={handleBulkCopyLinks}
                disabled={!can("copyLink") || loading || (!objects.length && selectedKeys.size === 0)}
                title="Copy links for this folder or selection"
              >
                <Link2 size={16} /> Copy links
              </button>
              <button
                className="danger"
                onClick={handleBulkDelete}
                disabled={!can("delete") || selectedKeys.size === 0}
                title="Delete selected items"
              >
                <Trash2 size={16} /> Delete
              </button>
              <button
                className="ghost"
                onClick={() => setSelectedKeys(new Set())}
                disabled={selectedKeys.size === 0}
                title="Clear selection"
              >
                Clear selection
              </button>
            </div>
          </div>

          <div className="list">
            <div className="list-head">
              <span className="selection-cell">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all files on this page"
                  checked={objects.length > 0 && selectedKeys.size === objects.length}
                  onChange={selectAllOnPage}
                  disabled={!objects.length}
                />
              </span>
              <span>Name</span>
              <span>Size</span>
              <span>
                <button className="sortable" onClick={toggleLastModifiedSort} title="Sort by last modified">
                  <ArrowDownUp size={14} />
                  <span>Last modified</span>
                  <span className="sort-indicator">{lastModifiedSort === "desc" ? "DESC" : "ASC"}</span>
                </button>
              </span>
              <span>Actions</span>
            </div>
            {loading && <div className="empty">Loading...</div>}
            {!loading && folders.length === 0 && objects.length === 0 && <div className="empty">Empty path</div>}
            {folders.map((folder) => (
              <div key={folder.prefix} className="list-row">
                <div className="selection-cell muted">—</div>
                <div className="name" onClick={() => changePrefix(folder.prefix)}>
                  <span className="name-icon" aria-hidden>
                    <Folder size={16} />
                  </span>
                  <Tippy
                    content={folder.name || "/"}
                    placement="top"
                    delay={[150, 0]}
                    theme="name"
                    appendTo={typeof document !== "undefined" ? () => document.body : undefined}
                  >
                    <span className="name-text" aria-label={folder.name || "/"}>{folder.name || "/"}</span>
                  </Tippy>
                </div>
                <div className="muted">—</div>
                <div className="muted">—</div>
                <div className="row-actions">
                  <button className="ghost" onClick={() => changePrefix(folder.prefix)} title="Open folder">
                    <FolderOpen size={16} /> Open
                  </button>
                  <button
                    className="icon danger"
                    disabled={!can("delete")}
                    onClick={() => handleDelete(folder.prefix)}
                    title="Delete folder"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {sortedObjects.map((object) => (
              <div key={object.key} className="list-row">
                <div className="selection-cell">
                  <input
                    type="checkbox"
                    aria-label={`Select ${object.key.slice(prefix.length)}`}
                    checked={selectedKeys.has(object.key)}
                    onChange={() => toggleSelection(object.key)}
                  />
                </div>
                <div className="name">
                  <span className="name-icon" aria-hidden>
                    {(() => {
                      const Icon = fileIconForKey(object.key);
                      return <Icon size={16} />;
                    })()}
                  </span>
                  <Tippy
                    content={object.key}
                    placement="top"
                    delay={[150, 0]}
                    theme="name"
                    appendTo={typeof document !== "undefined" ? () => document.body : undefined}
                  >
                    <span className="name-text" aria-label={object.key}>{object.key.slice(prefix.length)}</span>
                  </Tippy>
                </div>
                <div>{readableSize(object.size)}</div>
                <div className="muted">
                  {object.lastModified ? new Date(object.lastModified).toLocaleString() : "—"}
                </div>
                <div className="row-actions">
                  <button
                    className="ghost icon"
                    disabled={!can("copyLink")}
                    onClick={() => handleCopyLink(object.key)}
                    title="Copy link"
                  >
                    <Link2 size={16} />
                  </button>
                  <button
                    className="ghost icon"
                    disabled={!can("copyLink")}
                    onClick={() => handlePreview(object.key)}
                    title="Preview"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    className="icon danger"
                    disabled={!can("delete")}
                    onClick={() => handleDelete(object.key)}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isAdminRoute && (
        <div className="admin-layout">
          <aside className="panel admin-sidebar">
            <div>
              <p className="eyebrow">Admin</p>
              <h2>Controls</h2>
              <p className="muted">Manage users and keep an index of every object for faster lookups.</p>
            </div>
            <div className="admin-menu">
              <button
                className={`ghost admin-nav-button ${adminTab === "users" ? "active" : ""}`}
                onClick={() => setAdminTab("users")}
              >
                Users
              </button>
              <button
                className={`ghost admin-nav-button ${adminTab === "indexing" ? "active" : ""}`}
                onClick={() => setAdminTab("indexing")}
              >
                Indexing
              </button>
            </div>
          </aside>
          <div className="admin-content">
            {adminTab === "users" && (
              <UserManagement
                users={users}
                currentUserId={currentUserId}
                editingUserId={editingUserId}
                onSelectUser={setCurrentUserId}
                onAddUser={handleAddUser}
                onUpdateUser={handleUpdateUserMeta}
                onUpdatePermissions={handleUpdatePermissions}
                onRemoveUser={handleRemoveUser}
                onEdit={(id) => setEditingUserId(id)}
                onDoneEditing={() => setEditingUserId(null)}
              />
            )}
            {adminTab === "indexing" && <IndexingPanel onNotify={addToast} />}
          </div>
        </div>
      )}
      <ToastStack toasts={toasts} />
    </div>
  );
}

const ToastStack = ({ toasts }: { toasts: { id: number; text: string; type: "info" | "success" | "error" }[] }) => {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
};
