import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { hostInitials, hostLabel, hostSubtitle, type Host } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  hosts: Host[];
  selectedId: string | null;
  /** Host ids that have at least one live pane, for the sidebar's dot. */
  connectedIds: Set<string>;
  onSelect: (host: Host) => void;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onDuplicate: (host: Host) => void;
  onDelete: (host: Host) => void;
  onFiles: (host: Host) => void;
  onAdd: () => void;
  onLocal: () => void;
  onCopied: (what: string) => void;
  t: Translate;
}

export function Sidebar({
  hosts,
  selectedId,
  connectedIds,
  onSelect,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
  onFiles,
  onAdd,
  onLocal,
  onCopied,
  t,
}: Props) {
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? hosts.filter((host) =>
          [host.name, host.hostname, host.username, ...host.tags]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : hosts;

    // Grouped by the first tag, because that is the one people use as the environment.
    // Everything else lands in a single unlabelled group, kept last.
    const byTag = new Map<string, Host[]>();
    for (const host of matching) {
      const key = host.tags[0] ?? "";
      const bucket = byTag.get(key);
      if (bucket) bucket.push(host);
      else byTag.set(key, [host]);
    }
    return [...byTag.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [hosts, query]);

  const copy = async (text: string, label: string) => {
    await writeText(text);
    onCopied(label);
    setMenuFor(null);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h1>Mieterm</h1>
        <button className="ghost" onClick={onAdd} title={t("addServer")}>＋</button>
      </div>

      <div className="sidebar-search">
        <input
          value={query}
          placeholder={t("searchServers")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="sidebar-list" onClick={() => setMenuFor(null)}>
        {hosts.length === 0 && (
          <div className="empty">
            <strong>{t("noServers")}</strong>
            {t("noServersHint")}
          </div>
        )}

        {groups.map(([tag, groupHosts]) => (
          <div key={tag || "__untagged"}>
            {tag && <div className="group-label">{tag}</div>}
            {groupHosts.map((host) => (
              <div
                key={host.id}
                className={`host${host.id === selectedId ? " selected" : ""}`}
                onClick={() => onSelect(host)}
                onDoubleClick={() => onConnect(host)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(host.id === menuFor ? null : host.id);
                }}
                title={hostSubtitle(host)}
              >
                <div className="host-badge" style={{ background: `var(--dot-${host.color})` }}>
                  {hostInitials(host)}
                </div>
                <div className="host-text">
                  <div className="host-name">{hostLabel(host)}</div>
                  <div className="host-sub">{hostSubtitle(host)}</div>
                </div>
                {connectedIds.has(host.id) && <div className="host-live" />}
                <div className="host-actions" onClick={(e) => e.stopPropagation()}>
                  {/* The one-click copies: the things you paste into a ticket or another
                      tool the moment you look a server up. */}
                  <button
                    className="ghost"
                    title={t("copyHost")}
                    onClick={() => copy(host.hostname, t("copyHost"))}
                  >
                    ⧉
                  </button>
                  <button className="ghost" title={t("connect")} onClick={() => onConnect(host)}>
                    ▸
                  </button>
                </div>

                {menuFor === host.id && (
                  <HostMenu
                    host={host}
                    onClose={() => setMenuFor(null)}
                    onConnect={() => onConnect(host)}
                    onFiles={() => onFiles(host)}
                    onEdit={() => onEdit(host)}
                    onDuplicate={() => onDuplicate(host)}
                    onDelete={() => onDelete(host)}
                    onCopy={copy}
                    t={t}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <button onClick={onLocal}>{t("localTerminal")}</button>
        <button onClick={onAdd}>{t("addServer")}</button>
      </div>
    </aside>
  );
}

function HostMenu({
  host,
  onClose,
  onConnect,
  onFiles,
  onEdit,
  onDuplicate,
  onDelete,
  onCopy,
  t,
}: {
  host: Host;
  onClose: () => void;
  onConnect: () => void;
  onFiles: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopy: (text: string, label: string) => void;
  t: Translate;
}) {
  const sshCommand = `ssh${host.port === 22 ? "" : ` -p ${host.port}`} ${
    host.username ? `${host.username}@` : ""
  }${host.hostname}`;

  const items: Array<[string, () => void] | "divider"> = [
    [t("connect"), onConnect],
    [t("files"), onFiles],
    "divider",
    [t("copyHost"), () => onCopy(host.hostname, t("copyHost"))],
    [
      t("copyUserHost"),
      () => onCopy(`${host.username ? `${host.username}@` : ""}${host.hostname}`, t("copyUserHost")),
    ],
    [t("copySshCommand"), () => onCopy(sshCommand, t("copySshCommand"))],
    "divider",
    [t("edit"), onEdit],
    [t("duplicate"), onDuplicate],
    [t("delete"), onDelete],
  ];

  return (
    <div
      onMouseLeave={onClose}
      style={{
        position: "absolute",
        left: 12,
        top: "100%",
        zIndex: 30,
        minWidth: 190,
        background: "var(--bg)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius)",
        boxShadow: "0 8px 26px rgba(0,0,0,0.35)",
        padding: 4,
      }}
    >
      {items.map((item, index) =>
        item === "divider" ? (
          <div
            key={`d${index}`}
            style={{ height: 1, background: "var(--border)", margin: "4px 2px" }}
          />
        ) : (
          <button
            key={item[0]}
            className="ghost"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "4px 8px",
              color: item[0] === t("delete") ? "var(--danger)" : undefined,
            }}
            onClick={() => {
              item[1]();
              onClose();
            }}
          >
            {item[0]}
          </button>
        ),
      )}
    </div>
  );
}
