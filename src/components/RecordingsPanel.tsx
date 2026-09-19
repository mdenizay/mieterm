import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { asError, type AppError, type Recording, type RecordingMatch } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  enabled: boolean;
  onError: (error: AppError) => void;
  t: Translate;
}

export function RecordingsPanel({ enabled, onError, t }: Props) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RecordingMatch[] | null>(null);
  const [viewing, setViewing] = useState<{ id: string; text: string } | null>(null);

  const reload = () => {
    void api.listRecordings().then(setRecordings).catch((e) => onError(asError(e)));
  };

  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Search is debounced because it reads every log on disk; typing a word should not
  // start a full scan per keystroke.
  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setMatches(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.searchRecordings(needle).then(setMatches).catch((e) => onError(asError(e)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, onError]);

  if (viewing) {
    return (
      <>
        <div className="drawer-bar">
          <button onClick={() => setViewing(null)}>← {t("recordings")}</button>
        </div>
        <div className="drawer-body">
          <pre className="log">{viewing.text}</pre>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="drawer-bar">
        <input
          value={query}
          placeholder={t("searchRecordings")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="drawer-body">
        {!enabled && recordings.length === 0 && (
          <div className="empty">
            <strong>{t("noRecordings")}</strong>
            {t("recordingsHint")}
          </div>
        )}

        {matches !== null ? (
          <div className="rows">
            <div className="group-label">
              {matches.length} {t("matches")}
            </div>
            {matches.map((match, index) => (
              <div
                key={`${match.id}:${match.lineNumber}:${index}`}
                className="row clickable"
                onClick={() =>
                  void api
                    .readRecording(match.id)
                    .then((text) => setViewing({ id: match.id, text }))
                    .catch((e) => onError(asError(e)))
                }
              >
                <div className="row-main">
                  <div className="row-sub" style={{ color: "var(--text)" }}>{match.line}</div>
                  <div className="row-sub">
                    {match.title} · {match.lineNumber}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rows">
            {recordings.map((recording) => (
              <div
                key={recording.id}
                className="row clickable"
                onClick={() =>
                  void api
                    .readRecording(recording.id)
                    .then((text) => setViewing({ id: recording.id, text }))
                    .catch((e) => onError(asError(e)))
                }
              >
                <div className="row-main">
                  <div className="row-title">{recording.title}</div>
                  <div className="row-sub">
                    {recording.startedAt ? new Date(recording.startedAt).toLocaleString() : recording.id}
                  </div>
                </div>
                <div className="file-meta">{Math.max(1, Math.round(recording.bytes / 1024))} KB</div>
                <div className="row-actions">
                  <button
                    className="ghost danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.deleteRecording(recording.id).then(reload).catch((err) => onError(asError(err)));
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
