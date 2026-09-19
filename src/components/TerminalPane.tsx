import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { encodeText } from "../lib/bytes";
import { ready, subscribe } from "../lib/sessionBus";
import { findTheme } from "../lib/themes";
import { asError, type AppError, type Settings } from "../lib/types";
import type { Translate } from "../lib/i18n";

export interface PaneHandle {
  /** Sends text as if it had been typed. Used by snippets and the palette. */
  send: (text: string) => void;
  focus: () => void;
  openSearch: () => void;
  /** Everything currently in the scrollback, for "copy all". */
  contents: () => string;
}

interface Props {
  sessionId: string;
  hostId: string | null;
  startupCommand: string;
  settings: Settings;
  focused: boolean;
  /** Session ids that typing should also reach; empty when broadcast is off. */
  broadcastTargets: string[];
  onFocus: () => void;
  onExit: (code: number) => void;
  /** Asks the parent for a fresh session id, which remounts this pane. */
  onReconnect: () => void;
  onError: (error: AppError) => void;
  onTitle: (title: string) => void;
  registerHandle: (handle: PaneHandle | null) => void;
  t: Translate;
}

export function TerminalPane({
  sessionId,
  hostId,
  startupCommand,
  settings,
  focused,
  broadcastTargets,
  onFocus,
  onExit,
  onReconnect,
  onError,
  onTitle,
  registerHandle,
  t,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  // Read inside the xterm data callback, which is installed once and would otherwise
  // capture the first render's value forever.
  const broadcastRef = useRef<string[]>(broadcastTargets);
  broadcastRef.current = broadcastTargets;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);

  // The pane is built once. Font, theme and scrollback are applied in a separate effect
  // so a settings change does not tear down a live session.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const palette = findTheme(settings.terminalTheme);
    const terminal = new Terminal({
      allowProposedApi: true,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      theme: palette.theme,
      macOptionIsMeta: true,
      // The terminal renders its own selection highlight; letting the webview select the
      // DOM underneath it puts two selections on screen at once.
      rightClickSelectsWord: true,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(
      // Links open in the real browser, not inside the app window.
      new WebLinksAddon((_event, uri) => {
        void openUrl(uri);
      }),
    );
    terminal.open(mount);

    // The GPU renderer is a large win on a busy terminal, but it is unavailable on some
    // Linux/WebKitGTK setups and loses its context on others. Both cases fall back to the
    // DOM renderer rather than leaving a blank pane.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      /* DOM renderer it is. */
    }

    termRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;
    fit.fit();

    // A server can set the window title; it is the most accurate label a tab can have.
    terminal.onTitleChange((title) => {
      if (title.trim()) onTitle(title.trim());
    });

    terminal.onData((data) => {
      const encoded = encodeText(data);
      const targets = broadcastRef.current;
      if (targets.length > 1) {
        void api.broadcastSession(targets, encoded).catch((e) => onError(asError(e)));
      } else {
        void api.writeSession(sessionId, encoded).catch((e) => onError(asError(e)));
      }
    });

    if (settings.copyOnSelect) {
      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        if (selection) void writeText(selection).catch(() => undefined);
      });
    }

    // The startup command waits for the shell to say something, rather than running on a
    // timer: a prompt is the only reliable sign that there is something to type into.
    let startupSent = !startupCommand.trim();
    const unsubscribe = subscribe(
      sessionId,
      (bytes) => {
        terminal.write(bytes);
        if (!startupSent) {
          startupSent = true;
          void api.writeSession(sessionId, encodeText(`${startupCommand}\n`));
        }
      },
      (code) => {
        setExitCode(code);
        onExit(code);
      },
    );

    let disposed = false;
    void (async () => {
      await ready();
      if (disposed) return;
      try {
        await api.openSession({
          id: sessionId,
          hostId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch (e) {
        const error = asError(e);
        onError(error);
        terminal.writeln(`\r\n\x1b[31m${error.message}\x1b[0m`);
        if (error.detail) terminal.writeln(`\x1b[90m${error.detail}\x1b[0m`);
        setExitCode(1);
      }
    })();

    // A pane is resized by the window, by the drawer opening, and by a split — all of
    // which the observer catches, where a window listener alone would not.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void api.resizeSession(sessionId, terminal.cols, terminal.rows);
      } catch {
        /* the pane is mid-teardown */
      }
    });
    observer.observe(mount);

    return () => {
      disposed = true;
      observer.disconnect();
      unsubscribe();
      terminal.dispose();
      void api.closeSession(sessionId);
    };
    // Intentionally built once per session: the props it reads at construction are either
    // constant for the pane's life or handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Settings changes are applied in place, so restyling does not drop the connection.
  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) return;
    const palette = findTheme(settings.terminalTheme);
    terminal.options.theme = palette.theme;
    terminal.options.fontFamily = settings.fontFamily;
    terminal.options.fontSize = settings.fontSize;
    terminal.options.cursorStyle = settings.cursorStyle;
    terminal.options.cursorBlink = settings.cursorBlink;
    terminal.options.scrollback = settings.scrollback;
    fitRef.current?.fit();
    void api.resizeSession(sessionId, terminal.cols, terminal.rows);
  }, [
    settings.terminalTheme,
    settings.fontFamily,
    settings.fontSize,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.scrollback,
    sessionId,
  ]);

  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  const contents = useCallback(() => {
    const terminal = termRef.current;
    if (!terminal) return "";
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 1) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    }
    // Trailing blank lines are the unused part of the viewport, not content.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join("\n");
  }, []);

  useEffect(() => {
    const handle: PaneHandle = {
      send: (text) => {
        void api.writeSession(sessionId, encodeText(text)).catch((e) => onError(asError(e)));
        termRef.current?.focus();
      },
      focus: () => termRef.current?.focus(),
      openSearch: () => setSearchOpen(true),
      contents,
    };
    registerHandle(handle);
    return () => registerHandle(null);
  }, [sessionId, contents, registerHandle, onError]);

  const runSearch = (direction: "next" | "previous") => {
    if (!query) return;
    const search = searchRef.current;
    if (!search) return;
    if (direction === "next") search.findNext(query);
    else search.findPrevious(query);
  };

  return (
    <div className="pane-body" onMouseDown={onFocus}>
      {searchOpen && (
        <div className="find-bar">
          <input
            autoFocus
            value={query}
            placeholder={t("find")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(e.shiftKey ? "previous" : "next");
              if (e.key === "Escape") {
                setSearchOpen(false);
                searchRef.current?.clearDecorations();
                termRef.current?.focus();
              }
            }}
          />
          <button className="quiet" onClick={() => runSearch("previous")}>
            <ChevronUpIcon className="icon" />
          </button>
          <button className="quiet" onClick={() => runSearch("next")}>
            <ChevronDownIcon className="icon" />
          </button>
          <button
            className="quiet"
            onClick={() => {
              setSearchOpen(false);
              termRef.current?.focus();
            }}
          >
            <XMarkIcon className="icon" />
          </button>
        </div>
      )}

      <div ref={mountRef} style={{ height: "100%" }} />

      {exitCode !== null && (
        <div className="pane-dead">
          <div>
            {t("disconnected")} — {t("exited")} ({exitCode})
          </div>
          <button className="primary" onClick={onReconnect}>
            {t("reconnect")}
          </button>
        </div>
      )}
    </div>
  );
}
