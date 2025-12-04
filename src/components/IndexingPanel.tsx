import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCcw, Repeat, Timer, FileText, Eye } from "lucide-react";
import { fetchIndexStatus, rebuildIndexApi, refreshIndexApi, searchIndex, getLink } from "../client/api";
import type { IndexStatus, IndexedObject } from "../types";

type Props = {
  onNotify: (text: string, type?: "info" | "success" | "error") => void;
};

const formatWhen = (value: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

const formatRelative = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "Just now";
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 45) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

const readableSize = (size: number) => {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** exponent;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
};

export function IndexingPanel({ onNotify }: Props) {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<"full" | "delta" | null>(null);
  const [recent, setRecent] = useState<IndexedObject[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const [total, setTotal] = useState(0);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchIndexStatus();
      setStatus(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load index status";
      onNotify(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  const loadIndexList = useCallback(
    async (opts?: { page?: number; search?: string }) => {
      setLoading(true);
      try {
        const nextPage = opts?.page ?? 0;
        const query = opts?.search ?? "";
        const res = await searchIndex({ search: query || undefined, limit: pageSize, offset: nextPage * pageSize });
        setRecent(res.items);
        setTotal(res.total);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to load indexed objects";
        onNotify(msg, "error");
      } finally {
        setLoading(false);
      }
    },
    [onNotify, pageSize],
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadIndexList({ page: 0, search: debouncedSearch });
    setPage(0);
  }, [debouncedSearch, loadIndexList]);

  useEffect(() => {
    void loadIndexList({ page, search: debouncedSearch });
  }, [page, debouncedSearch, loadIndexList]);

  const runFull = async () => {
    setRunning("full");
    try {
      const result = await rebuildIndexApi();
      onNotify(
        `Rebuilt index with ${result.indexed} file(s)${
          result.folders !== undefined ? ` and ${result.folders} folder(s)` : ""
        }`,
        "success",
      );
      await loadStatus();
      await loadIndexList({ page, search: debouncedSearch });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to rebuild index";
      onNotify(msg, "error");
    } finally {
      setRunning(null);
    }
  };

  const runDelta = async () => {
    setRunning("delta");
    try {
      const result = await refreshIndexApi();
      onNotify(
        `Delta sync complete: +${result.added} new, ${result.updated} updated, ${result.removed} removed${
          result.files !== undefined && result.folders !== undefined
            ? ` — now ${result.files} files, ${result.folders} folders`
            : ""
        }`,
        "success",
      );
      await loadStatus();
      await loadIndexList({ page, search: debouncedSearch });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to refresh index";
      onNotify(msg, "error");
    } finally {
      setRunning(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handlePreview = async (key: string) => {
    try {
      const result = await getLink(key);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to open preview";
      onNotify(msg, "error");
    }
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Indexing</p>
          <h2>S3 object index</h2>
          <p className="muted">Scan the bucket and keep a queryable catalog by name, extension, and size.</p>
        </div>
        <div className="admin-action-group">
          <button className="ghost" onClick={loadStatus} disabled={loading || Boolean(running)} title="Refresh status">
            <RefreshCcw size={16} /> Refresh status
          </button>
          <button onClick={runDelta} disabled={running === "delta"} title="Index only new or changed objects">
            <Repeat size={16} /> Delta sync
          </button>
          <button className="danger" onClick={runFull} disabled={running === "full"} title="Full re-index of bucket">
            <Database size={16} /> Full rebuild
          </button>
        </div>
      </header>

      <div className="index-grid">
        <div className="index-card">
          <div className="index-card-title">
            <Database size={16} /> Indexed objects
          </div>
          <div className="index-card-value">{status?.objectCount ?? "—"}</div>
        </div>
        <div className="index-card">
          <div className="index-card-title">
            <Timer size={16} /> Last full scan
          </div>
          <div className="index-card-value">{formatWhen(status?.lastFullScan ?? null)}</div>
        </div>
        <div className="index-card">
          <div className="index-card-title">
            <Timer size={16} /> Last delta scan
          </div>
          <div className="index-card-value">{formatWhen(status?.lastDeltaScan ?? null)}</div>
        </div>
      </div>
      {loading && <p className="muted">Loading status…</p>}
      <div className="recent-index">
        <div className="recent-header">
          <div>
            <p className="eyebrow">Index entries</p>
            <h3>
              Indexed objects{" "}
              {total
                ? `(${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)} of ${total})`
                : "(0)"}
            </h3>
          </div>
          <div className="recent-actions">
            <div className="index-search">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search index by name, key, or extension"
                aria-label="Search index"
              />
              {search && (
                <button className="ghost" onClick={() => setSearch("")}>
                  Clear
                </button>
              )}
            </div>
            <button className="ghost" onClick={() => loadIndexList({ page })} disabled={loading || Boolean(running)}>
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>
        </div>
        {!recent.length && <p className="muted">No index entries yet.</p>}
        {recent.length > 0 && (
          <div className="recent-table">
            <div className="recent-row recent-head">
              <span>Name</span>
              <span>Type</span>
              <span>Extension</span>
              <span>Size</span>
              <span>Updated</span>
              <span>Actions</span>
            </div>
            {recent.map((item) => (
              <div key={item.key} className="recent-row">
                <span className="recent-name">
                  <FileText size={14} /> {item.name}
                </span>
                <span>{item.type === "folder" ? "Folder" : "File"}</span>
                <span>{item.type === "folder" ? "—" : item.extension || "—"}</span>
                <span>{item.type === "folder" ? "—" : readableSize(item.size)}</span>
                <span>{formatRelative(item.updatedAt)}</span>
                <span className="recent-actions-cell">
                  <button
                    className="ghost icon"
                    disabled={item.type === "folder"}
                    title={item.type === "folder" ? "Preview not available for folders" : "Preview object"}
                    onClick={() => handlePreview(item.key)}
                  >
                    <Eye size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="recent-pager">
          <span>
            Page {page + 1} / {totalPages} · {total} item(s)
          </span>
          <div className="recent-pager-buttons">
            <button className="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Prev
            </button>
            <button
              className="ghost"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
