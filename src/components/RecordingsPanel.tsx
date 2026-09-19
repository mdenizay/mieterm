import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
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
  const [viewing, setViewing] = useState<string | null>(null);

  const reload = () => {
    void api.listRecordings().then(setRecordings).catch((e) => onError(asError(e)));
  };

  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced, because a search reads every log on disk; typing a word should not start a
  // full scan per keystroke.
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

  const openRecording = (id: string) => {
    void api
      .readRecording(id)
      .then(setViewing)
      .catch((e) => onError(asError(e)));
  };

  if (viewing !== null) {
    return (
      <>
        <div className="drawer-toolbar">
          <button onClick={() => setViewing(null)}>
            <ArrowLeftIcon className="icon" />
            {t("recordings")}
          </button>
        </div>
        <div className="drawer-body">
          <pre className="log">{viewing}</pre>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="drawer-toolbar">
        <div style={{ position: "relative", display: "flex", alignItems: "center", flex: 1 }}>
          <MagnifyingGlassIcon
            className="icon"
            style={{ position: "absolute", left: 6, color: "var(--text-faint)" }}
          />
          <input
            value={query}
            placeholder={t("searchRecordings")}
            style={{ paddingLeft: 26 }}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="drawer-body">
        {recordings.length === 0 && matches === null && (
          <div className="empty">
            <ClockIcon className="icon-xl" />
            <div>{t("noRecordings")}</div>
            {!enabled && <div className="hint">{t("recordingsHint")}</div>}
          </div>
        )}

        {matches !== null ? (
          <div className="list">
            <div className="group-title">
              {matches.length} {t("matches")}
            </div>
            {matches.map((match, index) => (
              <div
                key={`${match.id}:${match.lineNumber}:${index}`}
                className="list-item"
                onClick={() => openRecording(match.id)}
              >
                <span className="label">
                  <div className="sub" style={{ color: "var(--text)" }}>{match.line}</div>
                  <div className="sub">
                    {match.title} · {match.lineNumber}
                  </div>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="list">
            {recordings.map((recording) => (
              <div key={recording.id} className="list-item" onClick={() => openRecording(recording.id)}>
                <ClockIcon className="icon" style={{ color: "var(--text-faint)" }} />
                <span className="label">
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{recording.title}</div>
                  <div className="sub">
                    {recording.startedAt
                      ? new Date(recording.startedAt).toLocaleString()
                      : recording.id}
                  </div>
                </span>
                <span className="meta">{Math.max(1, Math.round(recording.bytes / 1024))} KB</span>
                <span className="trailing">
                  <button
                    className="quiet"
                    title={t("delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void api
                        .deleteRecording(recording.id)
                        .then(reload)
                        .catch((err) => onError(asError(err)));
                    }}
                  >
                    <TrashIcon className="icon" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
