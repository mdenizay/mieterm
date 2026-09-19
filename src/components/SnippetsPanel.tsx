import { useEffect, useState } from "react";
import { BookmarkIcon, PencilSquareIcon, PlayIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api } from "../lib/api";
import { asError, type AppError, type Snippet } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  /** Runs the snippet in the focused pane; null when nothing is connected. */
  onRun: ((snippet: Snippet) => void) | null;
  onError: (error: AppError) => void;
  t: Translate;
}

function emptySnippet(): Snippet {
  return { id: "", name: "", command: "", tags: [], noNewline: false };
}

export function SnippetsPanel({ onRun, onError, t }: Props) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editing, setEditing] = useState<Snippet | null>(null);

  const reload = () => {
    void api.listSnippets().then(setSnippets).catch((e) => onError(asError(e)));
  };

  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <div className="drawer-form">
        <div className="field">
          <label>{t("name")}</label>
          <input
            autoFocus
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label>{t("command")}</label>
          <textarea
            rows={4}
            value={editing.command}
            onChange={(e) => setEditing({ ...editing, command: e.target.value })}
          />
        </div>
        <div className="field">
          <label>{t("tags")}</label>
          <input
            value={editing.tags.join(", ")}
            onChange={(e) =>
              setEditing({
                ...editing,
                tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={editing.noNewline}
            onChange={(e) => setEditing({ ...editing, noNewline: e.target.checked })}
          />
          {t("sendWithoutNewline")}
        </label>
        <div className="row">
          <div className="spacer" />
          <button style={{ flex: "0 0 auto" }} onClick={() => setEditing(null)}>{t("cancel")}</button>
          <button
            className="primary"
            style={{ flex: "0 0 auto" }}
            disabled={!editing.command.trim()}
            onClick={() =>
              void api
                .saveSnippet(editing)
                .then(() => {
                  setEditing(null);
                  reload();
                })
                .catch((e) => onError(asError(e)))
            }
          >
            {t("save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="drawer-toolbar">
        <button onClick={() => setEditing(emptySnippet())}>
          <PlusIcon className="icon" />
          {t("newSnippet")}
        </button>
      </div>
      <div className="drawer-body">
        {snippets.length === 0 && (
          <div className="empty">
            <BookmarkIcon className="icon-xl" />
            <div>{t("snippets")}</div>
          </div>
        )}
        <div className="list">
          {snippets.map((snippet) => (
            <div key={snippet.id} className="list-item">
              <BookmarkIcon className="icon" style={{ color: "var(--text-faint)" }} />
              <span className="label">
                <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{snippet.name}</div>
                <div className="sub">{snippet.command}</div>
              </span>
              <span className="trailing">
                <button className="quiet" title={t("runSnippet")} disabled={!onRun} onClick={() => onRun?.(snippet)}>
                  <PlayIcon className="icon" />
                </button>
                <button className="quiet" title={t("edit")} onClick={() => setEditing(snippet)}>
                  <PencilSquareIcon className="icon" />
                </button>
                <button
                  className="quiet"
                  title={t("delete")}
                  onClick={() =>
                    void api.deleteSnippet(snippet.id).then(reload).catch((e) => onError(asError(e)))
                  }
                >
                  <TrashIcon className="icon" />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
