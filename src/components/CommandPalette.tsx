import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkIcon, MagnifyingGlassIcon, ServerStackIcon } from "@heroicons/react/24/outline";
import { hostLabel, hostSubtitle, type Host, type Snippet } from "../lib/types";
import type { Translate } from "../lib/i18n";

export type PaletteAction =
  | { kind: "host"; host: Host }
  | { kind: "snippet"; snippet: Snippet }
  | { kind: "command"; id: string };

interface Command {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface Props {
  hosts: Host[];
  snippets: Snippet[];
  commands: Command[];
  /** True when a pane is focused, which is what makes snippets runnable. */
  canRunSnippets: boolean;
  onPick: (action: PaletteAction) => void;
  onClose: () => void;
  t: Translate;
}

export function CommandPalette({
  hosts,
  snippets,
  commands,
  canRunSnippets,
  onPick,
  onClose,
  t,
}: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

    const items: Array<{
      action: PaletteAction;
      icon: React.ComponentType<{ className?: string }>;
      label: string;
      detail: string;
    }> = [];

    for (const command of commands) {
      if (matches(command.label)) {
        items.push({
          action: { kind: "command", id: command.id },
          icon: command.icon,
          label: command.label,
          detail: "",
        });
      }
    }
    for (const host of hosts) {
      if (matches(`${hostLabel(host)} ${hostSubtitle(host)} ${host.tags.join(" ")}`)) {
        items.push({
          action: { kind: "host", host },
          icon: ServerStackIcon,
          label: hostLabel(host),
          detail: hostSubtitle(host),
        });
      }
    }
    if (canRunSnippets) {
      for (const snippet of snippets) {
        if (matches(`${snippet.name} ${snippet.command} ${snippet.tags.join(" ")}`)) {
          items.push({
            action: { kind: "snippet", snippet },
            icon: BookmarkIcon,
            label: snippet.name,
            detail: snippet.command,
          });
        }
      }
    }
    return items.slice(0, 60);
  }, [query, hosts, snippets, commands, canRunSnippets]);

  // A changing result list must not leave the highlight past its end.
  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div className="scrim palette-scrim" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <MagnifyingGlassIcon className="icon" style={{ color: "var(--text-faint)" }} />
          <input
            autoFocus
            value={query}
            placeholder={t("paletteHint")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const picked = results[index];
                if (picked) onPick(picked.action);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="empty" style={{ padding: 20 }}>—</div>}
          {results.map((item, i) => (
            <div
              key={`${item.label}:${i}`}
              className={`palette-item${i === index ? " active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onPick(item.action)}
            >
              <item.icon className="icon" />
              <span className="label">{item.label}</span>
              <span className="detail">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
