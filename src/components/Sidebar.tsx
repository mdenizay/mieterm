import { useMemo, useState } from "react";
import {
  BoltIcon,
  ClipboardDocumentIcon,
  CommandLineIcon,
  DocumentDuplicateIcon,
  FolderIcon,
  KeyIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  ServerStackIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { hostLabel, hostSubtitle, sshCommand, type Host } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  hosts: Host[];
  selectedId: string | null;
  /** Host ids with at least one live pane, for the status dot. */
  connectedIds: Set<string>;
  onSelect: (host: Host) => void;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onDuplicate: (host: Host) => void;
  onDelete: (host: Host) => void;
  onFiles: (host: Host) => void;
  onAdd: () => void;
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
  onCopied,
  t,
}: Props) {
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
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
  }, [hosts, filter]);

  const copy = async (text: string, label: string) => {
    await writeText(text);
    onCopied(label);
  };

  const hostMenu = (host: Host): MenuItem[] => [
    { label: t("connect"), icon: BoltIcon, onSelect: () => onConnect(host) },
    { label: t("files"), icon: FolderIcon, onSelect: () => onFiles(host) },
    {
      label: t("copyHost"),
      icon: ClipboardDocumentIcon,
      separatorBefore: true,
      onSelect: () => void copy(host.hostname, t("copyHost")),
    },
    {
      label: t("copyUserHost"),
      icon: ClipboardDocumentIcon,
      onSelect: () =>
        void copy(`${host.username ? `${host.username}@` : ""}${host.hostname}`, t("copyUserHost")),
    },
    {
      label: t("copySshCommand"),
      icon: CommandLineIcon,
      onSelect: () => void copy(sshCommand(host), t("copySshCommand")),
    },
    {
      label: t("edit"),
      icon: PencilSquareIcon,
      separatorBefore: true,
      onSelect: () => onEdit(host),
    },
    { label: t("duplicate"), icon: DocumentDuplicateIcon, onSelect: () => onDuplicate(host) },
    { label: t("delete"), icon: TrashIcon, danger: true, onSelect: () => onDelete(host) },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <MagnifyingGlassIcon
            className="icon"
            style={{ position: "absolute", left: 6, color: "var(--text-faint)" }}
          />
          <input
            value={filter}
            placeholder={t("searchServers")}
            style={{ paddingLeft: 26 }}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-body">
        {hosts.length === 0 && (
          <div className="empty" style={{ paddingTop: 36 }}>
            <ServerStackIcon className="icon-xl" />
            <div>{t("noServers")}</div>
            <div className="hint">{t("noServersHint")}</div>
            <button className="primary" onClick={onAdd}>
              <ServerStackIcon className="icon" />
              {t("addServer")}
            </button>
          </div>
        )}

        {groups.map(([tag, groupHosts]) => (
          <div key={tag || "__untagged"}>
            {tag && <div className="group-title">{tag}</div>}
            {groupHosts.map((host) => (
              <div
                key={host.id}
                className={`tree-row${host.id === selectedId ? " selected" : ""}`}
                onClick={() => onSelect(host)}
                onDoubleClick={() => onConnect(host)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(host);
                  setMenu({ x: e.clientX, y: e.clientY, items: hostMenu(host) });
                }}
              >
                <span
                  className="status-dot"
                  title={connectedIds.has(host.id) ? t("connected") : t("notConnected")}
                  style={{
                    background: connectedIds.has(host.id) ? "var(--success)" : "var(--text-faint)",
                  }}
                />
                <ServerStackIcon className="icon" style={{ color: `var(--dot-${host.color})` }} />
                <span className="label">
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{hostLabel(host)}</div>
                  <div className="sub">{hostSubtitle(host)}</div>
                </span>
                {host.auth === "key" && (
                  <KeyIcon className="icon" style={{ color: "var(--text-faint)" }} />
                )}
                {host.auth === "password" && (
                  <LockClosedIcon className="icon" style={{ color: "var(--text-faint)" }} />
                )}
                <span className="trailing">
                  <button
                    className="quiet"
                    title={t("copyHost")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void copy(host.hostname, t("copyHost"));
                    }}
                  >
                    <ClipboardDocumentIcon className="icon" />
                  </button>
                  <button
                    className="quiet"
                    title={t("edit")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(host);
                    }}
                  >
                    <PencilSquareIcon className="icon" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  );
}
