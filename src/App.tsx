import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDownUp,
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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastModifiedSort, setLastModifiedSort] = useState<"asc" | "desc">("desc");
  const [isAuthed, setIsAuthed] = useState(() => Boolean(auth.token));
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const isUnauthorized = (err: unknown) => err instanceof Error && /unauthorized/i.test(err.message || "");

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
      setError(msg);
      if (isUnauthorized(err)) logout();
    }
  }, [isAuthed, currentUserId]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

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
    setError(null);
    setNextToken(undefined);
    try {
      const data = await listObjects({
        prefix,
        token: pageTokens[pageIndex] || undefined,
        pageSize: 50,
        search: searchQuery || undefined,
      });
      setFolders(data.folders);
      setObjects(data.objects);
      setNextToken(data.nextToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to list objects";
      setError(msg);
      if (isUnauthorized(err)) logout();
    } finally {
      setLoading(false);
    }
  }, [permissions.list, prefix, pageIndex, pageTokens, searchQuery]);

  useEffect(() => {
    if (!isAuthed) return;
    void (async () => {
      try {
        const info = await fetchMeta();
        setMeta(info);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to load bucket metadata";
        setError(msg);
        if (isUnauthorized(err)) logout();
      }
    })();
  }, [isAuthed]);

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
    setSelectedKeys(new Set());
  }, [prefix, pageIndex, searchQuery]);

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
      setMessage(`Created ${newFolderName}`);
      void loadObjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to create folder";
      setError(msg);
      if (isUnauthorized(err)) logout();
    }
  };

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setMessage(`Uploading ${files.length} item(s)...`);
      try {
        await uploadFiles(
          prefix,
          Array.from(files).map((file) => file as File & { webkitRelativePath?: string }),
        );
        setMessage("Upload complete");
        await loadObjects();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        if (isUnauthorized(err)) logout();
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [prefix, loadObjects, isUnauthorized],
  );

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete ${key}?`)) return;
    try {
      await deleteObject(key);
      setMessage(`Deleted ${key}`);
      void loadObjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to delete object";
      setError(msg);
      if (isUnauthorized(err)) logout();
    }
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
      setMessage(`${result.kind === "public" ? "Public" : "Signed"} link copied`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to create link";
      setError(msg);
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
      setError("No files to copy from this folder");
      return;
    }
    setError(null);
    setMessage(`Copying ${keys.length} link(s)...`);
    try {
      const links = await Promise.all(
        keys.map(async (key) => {
          const result = await getLink(key);
          return result.url;
        }),
      );
      await copyToClipboard(links.join("\n"));
      setMessage(
        `Copied ${keys.length} link(s) ${selectedKeys.size ? "from selection" : "from current folder"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to copy links";
      setError(msg);
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
      setError(msg);
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
      setError(msg);
      if (isUnauthorized(err)) logout();
    }
  };

  const handleUpdateUserMeta = async (id: string, updates: Partial<User>) => {
    try {
      await updateUserApi(id, updates);
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to update user";
      setError(msg);
      if (isUnauthorized(err)) logout();
    }
  };

  const handleUpdatePermissions = async (id: string, perms: Record<PermissionKey, boolean>) => {
    try {
      await updateUserApi(id, { permissions: perms });
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to update permissions";
      setError(msg);
      if (isUnauthorized(err)) logout();
    }
  };

  const handleRemoveUser = async (id: string) => {
    try {
      await deleteUserApi(id);
      await loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to remove user";
      setError(msg);
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
          {message && <span className="pill success">{message}</span>}
          {error && <span className="pill danger">{error}</span>}
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
                placeholder="Search by object key..."
                title="Search by key name"
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
                  <span className="name-icon">📁</span>
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
                  <span className="name-icon">📄</span>
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
    </div>
  );
}
