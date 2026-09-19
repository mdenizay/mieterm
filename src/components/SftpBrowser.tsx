import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { asError, hostLabel, type AppError, type Host, type RemoteFile } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  host: Host;
  onError: (error: AppError) => void;
  onBusy: (message: string | null) => void;
  t: Translate;
}

export function SftpBrowser({ host, onError, onBusy, t }: Props) {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState<RemoteFile | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // The connection is opened in an effect and closed on unmount; the ref is what lets the
  // cleanup see the id even when the component unmounts before connect() resolves.
  const connectionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFiles([]);
    void (async () => {
      try {
        const id = await api.sftpConnect(host.id);
        if (cancelled) {
          void api.sftpDisconnect(id);
          return;
        }
        connectionRef.current = id;
        setConnectionId(id);
        const home = await api.sftpHome(id);
        setPath(home);
        setPathDraft(home);
      } catch (e) {
        if (!cancelled) {
          onError(asError(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      const id = connectionRef.current;
      connectionRef.current = null;
      if (id) void api.sftpDisconnect(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.id]);

  const refresh = useCallback(
    async (target?: string) => {
      const id = connectionRef.current;
      if (!id) return;
      const where = target ?? path;
      if (!where) return;
      setLoading(true);
      try {
        const listing = await api.sftpList(id, where);
        setFiles(listing);
        setPath(where);
        setPathDraft(where);
      } catch (e) {
        onError(asError(e));
      } finally {
        setLoading(false);
      }
    },
    [path, onError],
  );

  useEffect(() => {
    if (connectionId && path) void refresh(path);
    // Only when the connection or the target directory changes, not on every refresh
    // identity change — which would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, path]);

  const visible = useMemo(
    () => (showHidden ? files : files.filter((f) => !f.name.startsWith("."))),
    [files, showHidden],
  );

  const parent = useMemo(() => {
    if (!path || path === "/") return null;
    const trimmed = path.replace(/\/+$/, "");
    const index = trimmed.lastIndexOf("/");
    return index <= 0 ? "/" : trimmed.slice(0, index);
  }, [path]);

  const join = (name: string) => (path.endsWith("/") ? `${path}${name}` : `${path}/${name}`);

  const download = async (file: RemoteFile) => {
    const id = connectionRef.current;
    if (!id) return;
    const target = await saveFileDialog({ defaultPath: file.name });
    if (!target) return;
    onBusy(`${t("download")}: ${file.name}`);
    try {
      await api.sftpDownload(id, file.path, target);
    } catch (e) {
      onError(asError(e));
    } finally {
      onBusy(null);
    }
  };

  const upload = async () => {
    const id = connectionRef.current;
    if (!id) return;
    const selected = await openFileDialog({ multiple: true, directory: false });
    const locals = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (locals.length === 0) return;
    try {
      for (const local of locals) {
        const name = local.split(/[\\/]/).pop() ?? "upload";
        onBusy(`${t("upload")}: ${name}`);
        await api.sftpUpload(id, local, join(name));
      }
      await refresh();
    } catch (e) {
      onError(asError(e));
    } finally {
      onBusy(null);
    }
  };

  const makeDirectory = async () => {
    const id = connectionRef.current;
    if (!id) return;
    const name = window.prompt(t("newFolder"));
    if (!name?.trim()) return;
    try {
      await api.sftpMkdir(id, join(name.trim()));
      await refresh();
    } catch (e) {
      onError(asError(e));
    }
  };

  const commitRename = async () => {
    const id = connectionRef.current;
    const file = renaming;
    if (!id || !file) return;
    const name = renameDraft.trim();
    setRenaming(null);
    if (!name || name === file.name) return;
    try {
      await api.sftpRename(id, file.path, join(name));
      await refresh();
    } catch (e) {
      onError(asError(e));
    }
  };

  const remove = async (file: RemoteFile) => {
    const id = connectionRef.current;
    if (!id) return;
    if (!window.confirm(t("confirmDelete", { name: file.name }))) return;
    try {
      await api.sftpRemove(id, file.path, file.isDir);
      await refresh();
    } catch (e) {
      onError(asError(e));
    }
  };

  return (
    <>
      <div className="drawer-bar">
        <button className="ghost" disabled={!parent} title={t("parentFolder")} onClick={() => parent && setPath(parent)}>
          ↑
        </button>
        <input
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setPath(pathDraft.trim() || "/");
            if (e.key === "Escape") setPathDraft(path);
          }}
        />
        <button className="ghost" title={t("refresh")} onClick={() => void refresh()}>↻</button>
      </div>

      <div className="drawer-bar">
        <button onClick={upload} disabled={!connectionId}>{t("upload")}</button>
        <button onClick={makeDirectory} disabled={!connectionId}>{t("newFolder")}</button>
        <label className="checkbox" style={{ marginLeft: "auto", marginBottom: 0 }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          <span>{t("showHidden")}</span>
        </label>
      </div>

      <div className="drawer-body">
        {loading && <div className="empty">{t("connecting")}</div>}

        {!loading && visible.length === 0 && (
          <div className="empty">
            <strong>{t("emptyFolder")}</strong>
            {hostLabel(host)}
          </div>
        )}

        <div className="rows">
          {visible.map((file) => (
            <div
              key={file.path}
              className={`row${file.isDir ? " clickable" : ""}`}
              onDoubleClick={() => (file.isDir ? setPath(file.path) : void download(file))}
            >
              <div className="file-icon">{file.isDir ? "📁" : file.isSymlink ? "🔗" : "📄"}</div>
              <div className="row-main">
                {renaming?.path === file.path ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <>
                    <div className="row-title">{file.name}</div>
                    <div className="row-sub">
                      {file.permissions || "—"}
                      {file.modified ? ` · ${new Date(file.modified * 1000).toLocaleString()}` : ""}
                    </div>
                  </>
                )}
              </div>
              {!file.isDir && <div className="file-meta">{formatBytes(file.size)}</div>}
              <div className="row-actions">
                {!file.isDir && (
                  <button className="ghost" title={t("download")} onClick={() => void download(file)}>
                    ↓
                  </button>
                )}
                <button
                  className="ghost"
                  title={t("rename")}
                  onClick={() => {
                    setRenaming(file);
                    setRenameDraft(file.name);
                  }}
                >
                  ✎
                </button>
                <button className="ghost danger" title={t("delete")} onClick={() => void remove(file)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
