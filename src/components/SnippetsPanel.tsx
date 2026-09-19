import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { asError, type AppError, type Snippet } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  /** Runs the snippet in the focused pane; absent when nothing is connected. */
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
      <div className="drawer-body" style={{ padding: 12 }}>
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
        <label className="checkbox">
          <input
            type="checkbox"
            checked={editing.noNewline}
            onChange={(e) => setEditing({ ...editing, noNewline: e.target.checked })}
          />
          <span>{t("sendWithoutNewline")}</span>
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={() => setEditing(null)}>{t("cancel")}</button>
          <button
            className="primary"
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
      <div className="drawer-bar">
        <button onClick={() => setEditing(emptySnippet())}>{t("newSnippet")}</button>
      </div>
      <div className="drawer-body">
        <div className="rows">
          {snippets.map((snippet) => (
            <div key={snippet.id} className="row">
              <div className="row-main">
                <div className="row-title">{snippet.name}</div>
                <div className="row-sub">{snippet.command}</div>
              </div>
              <div className="row-actions">
                <button disabled={!onRun} onClick={() => onRun?.(snippet)}>
                  {t("runSnippet")}
                </button>
                <button className="ghost" onClick={() => setEditing(snippet)}>✎</button>
                <button
                  className="ghost danger"
                  onClick={() =>
                    void api.deleteSnippet(snippet.id).then(reload).catch((e) => onError(asError(e)))
                  }
                >
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
