import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkIcon,
  ClockIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  PlusIcon,
  ServerStackIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ForwardsPanel } from "./components/ForwardsPanel";
import { HostDialog } from "./components/HostDialog";
import { RecordingsPanel } from "./components/RecordingsPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { SftpBrowser } from "./components/SftpBrowser";
import { SnippetsPanel } from "./components/SnippetsPanel";
import { TerminalPane, type PaneHandle } from "./components/TerminalPane";
import { api } from "./lib/api";
import { encodeText } from "./lib/bytes";
import { translator } from "./lib/i18n";
import {
  asError,
  emptyHost,
  hostLabel,
  type AppError,
  type Host,
  type Settings,
  type Snippet,
} from "./lib/types";

interface Pane {
  id: string;
  /** Changing this remounts the terminal, which is how "reconnect" works. */
  sessionId: string;
  hostId: string | null;
  title: string;
  dead: boolean;
}

interface Tab {
  id: string;
  layout: "row" | "col";
  panes: Pane[];
  activePaneId: string;
}

type DrawerTab = "files" | "tunnels" | "snippets" | "recordings";

const uid = () => crypto.randomUUID();

function makePane(hostId: string | null, title: string): Pane {
  const id = uid();
  return { id, sessionId: id, hostId, title, dead: false };
}

export default function App() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);

  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [drawerHost, setDrawerHost] = useState<Host | null>(null);
  const [broadcast, setBroadcast] = useState(false);

  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [deletingHost, setDeletingHost] = useState<Host | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handles = useRef(new Map<string, PaneHandle>());

  const t = useMemo(() => translator(settings?.language ?? "en"), [settings?.language]);
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [tabs, activeTabId]);
  const activePane = useMemo(
    () => activeTab?.panes.find((pane) => pane.id === activeTab.activePaneId) ?? null,
    [activeTab],
  );
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? null,
    [hosts, selectedHostId],
  );

  // ------------------------------------------------------------ bootstrapping

  useEffect(() => {
    void (async () => {
      try {
        const [loadedHosts, loadedSettings, loadedSnippets] = await Promise.all([
          api.listHosts(),
          api.getSettings(),
          api.listSnippets(),
        ]);
        setHosts(loadedHosts);
        setSettings(loadedSettings);
        setSnippets(loadedSnippets);
      } catch (e) {
        setError(asError(e));
      }
    })();
  }, []);

  // The chrome follows the interface setting; "system" tracks the OS, live.
  useEffect(() => {
    if (!settings) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = settings.uiTheme === "system" ? media.matches : settings.uiTheme === "dark";
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings?.uiTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const persistSettings = useCallback((next: Settings) => {
    setSettings(next);
    void api.saveSettings(next).catch((e) => setError(asError(e)));
  }, []);

  // ------------------------------------------------------------ tabs and panes

  const openTab = useCallback((hostId: string | null, title: string) => {
    const pane = makePane(hostId, title);
    const tab: Tab = { id: uid(), layout: "row", panes: [pane], activePaneId: pane.id };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, []);

  const connect = useCallback(
    (host: Host) => {
      setSelectedHostId(host.id);
      openTab(host.id, hostLabel(host));
    },
    [openTab],
  );

  const splitActive = useCallback(
    (layout: "row" | "col") => {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const source = tab.panes.find((pane) => pane.id === tab.activePaneId) ?? tab.panes[0];
          // Four panes is where a split stops being readable at any sane window size.
          if (!source || tab.panes.length >= 4) return tab;
          const pane = makePane(source.hostId, source.title);
          return { ...tab, layout, panes: [...tab.panes, pane], activePaneId: pane.id };
        }),
      );
    },
    [activeTabId],
  );

  const closePane = useCallback((tabId: string, paneId: string) => {
    setTabs((current) => {
      const next: Tab[] = [];
      for (const tab of current) {
        if (tab.id !== tabId) {
          next.push(tab);
          continue;
        }
        const panes = tab.panes.filter((pane) => pane.id !== paneId);
        // The last pane closing takes the tab with it, which is what a terminal app does.
        if (panes.length === 0) continue;
        next.push({
          ...tab,
          panes,
          activePaneId: panes.some((p) => p.id === tab.activePaneId) ? tab.activePaneId : panes[0].id,
        });
      }
      return next;
    });
  }, []);

  // Keep the active tab pointing at something that still exists.
  useEffect(() => {
    if (tabs.length === 0) {
      if (activeTabId !== null) setActiveTabId(null);
      return;
    }
    if (!tabs.some((tab) => tab.id === activeTabId)) setActiveTabId(tabs[tabs.length - 1].id);
  }, [tabs, activeTabId]);

  const patchPane = useCallback((paneId: string, changes: Partial<Pane>) => {
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        panes: tab.panes.map((pane) => (pane.id === paneId ? { ...pane, ...changes } : pane)),
      })),
    );
  }, []);

  const connectedHostIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.hostId && !pane.dead) ids.add(pane.hostId);
      }
    }
    return ids;
  }, [tabs]);

  // Every live session in the current tab, which is what broadcast writes to.
  const broadcastTargets = useMemo(() => {
    if (!broadcast || !activeTab) return [];
    return activeTab.panes.filter((pane) => !pane.dead).map((pane) => pane.sessionId);
  }, [broadcast, activeTab]);

  // ------------------------------------------------------------ actions

  const runSnippet = useCallback(
    (snippet: Snippet) => {
      const pane = activePane;
      if (!pane) return;
      const text = snippet.noNewline ? snippet.command : `${snippet.command}\n`;
      if (broadcastTargets.length > 1) {
        // A snippet under broadcast is the whole point of broadcast, so it follows the
        // same rule typing does.
        void api
          .broadcastSession(broadcastTargets, encodeText(text))
          .catch((e) => setError(asError(e)));
      } else {
        handles.current.get(pane.id)?.send(text);
      }
    },
    [activePane, broadcastTargets],
  );

  const saveHostAndRefresh = useCallback(async (saved: Host) => {
    setHosts(await api.listHosts());
    setSelectedHostId(saved.id);
    setEditingHost(null);
  }, []);

  const deleteHost = useCallback(async (host: Host) => {
    try {
      await api.deleteHost(host.id);
      setHosts(await api.listHosts());
    } catch (e) {
      setError(asError(e));
    } finally {
      setDeletingHost(null);
    }
  }, []);

  const openFiles = useCallback((host: Host) => {
    setDrawerHost(host);
    setDrawer("files");
  }, []);

  const toggleDrawer = useCallback((tab: DrawerTab) => {
    setDrawer((current) => (current === tab ? null : tab));
  }, []);

  // ------------------------------------------------------------ shortcuts

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "t") {
        event.preventDefault();
        openTab(null, t("localTerminal"));
      } else if (event.key === "w") {
        event.preventDefault();
        if (activeTab && activePane) closePane(activeTab.id, activePane.id);
      } else if (event.key === "d") {
        event.preventDefault();
        splitActive(event.shiftKey ? "col" : "row");
      } else if (event.key === "f") {
        event.preventDefault();
        if (activePane) handles.current.get(activePane.id)?.openSearch();
      } else if (event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      } else if ((event.key === "=" || event.key === "+") && settings) {
        event.preventDefault();
        persistSettings({ ...settings, fontSize: Math.min(settings.fontSize + 1, 32) });
      } else if (event.key === "-" && settings) {
        event.preventDefault();
        persistSettings({ ...settings, fontSize: Math.max(settings.fontSize - 1, 8) });
      } else if (/^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (tabs[index]) {
          event.preventDefault();
          setActiveTabId(tabs[index].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, activePane, tabs, settings, openTab, closePane, splitActive, persistSettings, t]);

  const onPalettePick = useCallback(
    (action: PaletteAction) => {
      setPaletteOpen(false);
      if (action.kind === "host") connect(action.host);
      else if (action.kind === "snippet") runSnippet(action.snippet);
      else if (action.id === "local") openTab(null, t("localTerminal"));
      else if (action.id === "settings") setSettingsOpen(true);
      else if (action.id === "new-server") setEditingHost(emptyHost());
      else if (action.id === "split-right") splitActive("row");
      else if (action.id === "split-down") splitActive("col");
      else if (action.id === "tunnels") setDrawer("tunnels");
      else if (action.id === "recordings") setDrawer("recordings");
      else if (action.id === "snippets") setDrawer("snippets");
    },
    [connect, runSnippet, openTab, splitActive, t],
  );

  if (!settings) return <div className="empty">…</div>;

  const canSplit = Boolean(activeTab) && (activeTab?.panes.length ?? 0) < 4;

  return (
    <div className="app">
      <div className="chrome">
        <button className="chrome-button" onClick={() => setEditingHost(emptyHost())}>
          <ServerStackIcon className="icon-lg" />
          {t("addServer")}
        </button>
        <button
          className="chrome-button"
          disabled={!selectedHost}
          onClick={() => selectedHost && connect(selectedHost)}
        >
          <CommandLineIcon className="icon-lg" />
          {t("connect")}
        </button>
        <button className="chrome-button" onClick={() => openTab(null, t("localTerminal"))}>
          <PlusIcon className="icon-lg" />
          {t("localTerminal")}
        </button>

        <div className="chrome-divider" />

        <button className="chrome-button" disabled={!canSplit} onClick={() => splitActive("row")}>
          <ViewColumnsIcon className="icon-lg" />
          {t("splitRight")}
        </button>
        <button className="chrome-button" disabled={!canSplit} onClick={() => splitActive("col")}>
          <Squares2X2Icon className="icon-lg" />
          {t("splitDown")}
        </button>
        <button
          className={`chrome-button${broadcast ? " on" : ""}`}
          title={t("broadcastOn")}
          disabled={(activeTab?.panes.length ?? 0) < 2}
          onClick={() => setBroadcast((on) => !on)}
        >
          <MegaphoneIcon className="icon-lg" />
          {t("broadcast")}
        </button>

        <div className="chrome-divider" />

        <button
          className={`chrome-button${drawer === "files" ? " on" : ""}`}
          disabled={!selectedHost}
          onClick={() => (drawer === "files" ? setDrawer(null) : selectedHost && openFiles(selectedHost))}
        >
          <FolderIcon className="icon-lg" />
          {t("files")}
        </button>
        <button
          className={`chrome-button${drawer === "tunnels" ? " on" : ""}`}
          onClick={() => toggleDrawer("tunnels")}
        >
          <LinkIcon className="icon-lg" />
          {t("tunnels")}
        </button>
        <button
          className={`chrome-button${drawer === "snippets" ? " on" : ""}`}
          onClick={() => toggleDrawer("snippets")}
        >
          <BookmarkIcon className="icon-lg" />
          {t("snippets")}
        </button>
        <button
          className={`chrome-button${drawer === "recordings" ? " on" : ""}`}
          onClick={() => toggleDrawer("recordings")}
        >
          <ClockIcon className="icon-lg" />
          {t("recordings")}
        </button>

        <div className="spacer" />

        <button className="chrome-button" onClick={() => setPaletteOpen(true)}>
          <MagnifyingGlassIcon className="icon-lg" />
          {t("commandPalette")}
        </button>
        <button className="chrome-button" onClick={() => setSettingsOpen(true)}>
          <Cog6ToothIcon className="icon-lg" />
          {t("settings")}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <ExclamationTriangleIcon className="icon" />
          <div style={{ flex: 1 }}>
            {error.message}
            {error.detail && <div className="detail">{error.detail}</div>}
          </div>
          <button className="quiet" onClick={() => setError(null)}>
            <XMarkIcon className="icon" />
          </button>
        </div>
      )}

      <div className="body">
        <Sidebar
          hosts={hosts}
          selectedId={selectedHostId}
          connectedIds={connectedHostIds}
          onSelect={(host) => setSelectedHostId(host.id)}
          onConnect={connect}
          onEdit={(host) => setEditingHost(host)}
          onDuplicate={(host) => setEditingHost({ ...host, id: "", name: `${hostLabel(host)} copy` })}
          onDelete={(host) => setDeletingHost(host)}
          onFiles={openFiles}
          onAdd={() => setEditingHost(emptyHost())}
          onCopied={(what) => setToast(`${t("copied")}: ${what}`)}
          t={t}
        />

        <main className="main">
          {/* Hidden entirely when nothing is open, rather than left as an empty strip. */}
          {tabs.length > 0 && (
          <div className="tabs">
            {tabs.map((tab) => {
              const first = tab.panes[0];
              const allDead = tab.panes.every((pane) => pane.dead);
              const host = first?.hostId ? hosts.find((h) => h.id === first.hostId) : undefined;
              return (
                <button
                  key={tab.id}
                  className={`tab${tab.id === activeTabId ? " active" : ""}`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {host ? (
                    <ServerStackIcon
                      className="icon"
                      style={{ color: allDead ? "var(--text-faint)" : `var(--dot-${host.color})` }}
                    />
                  ) : (
                    <CommandLineIcon
                      className="icon"
                      style={{ color: allDead ? "var(--text-faint)" : "var(--text-muted)" }}
                    />
                  )}
                  <span className="title">
                    {first?.title ?? "—"}
                    {tab.panes.length > 1 ? ` (${tab.panes.length})` : ""}
                  </span>
                  <span
                    className="close"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTabs((current) => current.filter((candidate) => candidate.id !== tab.id));
                    }}
                  >
                    <XMarkIcon className="icon" style={{ width: 13, height: 13 }} />
                  </span>
                </button>
              );
            })}
          </div>
          )}

          {!activeTab ? (
            <div className="empty">
              <CommandLineIcon className="icon-xl" />
              <div>Mieterm</div>
              <div className="hint">{t("noServersHint")}</div>
              <button onClick={() => openTab(null, t("localTerminal"))}>
                <CommandLineIcon className="icon" />
                {t("localTerminal")}
              </button>
            </div>
          ) : (
            <div className={`panes${activeTab.layout === "col" ? " col" : ""}`}>
              {activeTab.panes.map((pane) => (
                <div
                  key={pane.id}
                  className={`pane${pane.id === activeTab.activePaneId ? " focused" : ""}`}
                >
                  {activeTab.panes.length > 1 && (
                    <div className="pane-toolbar">
                      <span>{pane.title}</span>
                      <div className="spacer" />
                      <button
                        className="quiet"
                        title={t("closePane")}
                        onClick={() => closePane(activeTab.id, pane.id)}
                      >
                        <XMarkIcon className="icon" />
                      </button>
                    </div>
                  )}
                  <TerminalPane
                    key={pane.sessionId}
                    sessionId={pane.sessionId}
                    hostId={pane.hostId}
                    startupCommand={hosts.find((h) => h.id === pane.hostId)?.startupCommand ?? ""}
                    settings={settings}
                    focused={pane.id === activeTab.activePaneId}
                    broadcastTargets={broadcastTargets}
                    onFocus={() =>
                      setTabs((current) =>
                        current.map((tab) =>
                          tab.id === activeTab.id ? { ...tab, activePaneId: pane.id } : tab,
                        ),
                      )
                    }
                    onExit={() => patchPane(pane.id, { dead: true })}
                    onReconnect={() => patchPane(pane.id, { sessionId: uid(), dead: false })}
                    onError={setError}
                    onTitle={(title) => patchPane(pane.id, { title })}
                    registerHandle={(handle) => {
                      if (handle) handles.current.set(pane.id, handle);
                      else handles.current.delete(pane.id);
                    }}
                    t={t}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="status-bar">
            <span className="meta">{settings.terminalTheme}</span>
            {activePane && <span className="meta">{activePane.title}</span>}
            {broadcast && (
              <span className="meta" style={{ color: "var(--accent)" }}>
                <MegaphoneIcon className="icon" />
                {t("broadcastOn")}
              </span>
            )}
            <div className="spacer" />
            {tabs.length > 0 && (
              <span className="meta">
                {tabs.length} {t("tabsLabel")}
              </span>
            )}
          </div>
        </main>

        {drawer && (
          <aside className="drawer">
            <div className="drawer-tabs">
              {(["files", "tunnels", "snippets", "recordings"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`drawer-tab${drawer === tab ? " active" : ""}`}
                  onClick={() => setDrawer(tab)}
                >
                  {t(tab)}
                </button>
              ))}
              <div className="spacer" />
              <button className="quiet" onClick={() => setDrawer(null)}>
                <XMarkIcon className="icon" />
              </button>
            </div>

            {drawer === "files" &&
              (drawerHost ? (
                <SftpBrowser
                  key={drawerHost.id}
                  host={drawerHost}
                  onError={setError}
                  onBusy={setToast}
                  t={t}
                />
              ) : (
                <div className="empty">
                  <FolderIcon className="icon-xl" />
                  <div>{t("files")}</div>
                  <div className="hint">{t("filesHint")}</div>
                </div>
              ))}

            {drawer === "tunnels" && <ForwardsPanel hosts={hosts} onError={setError} t={t} />}

            {drawer === "snippets" && (
              <SnippetsPanel onRun={activePane ? runSnippet : null} onError={setError} t={t} />
            )}

            {drawer === "recordings" && (
              <RecordingsPanel enabled={settings.recordSessions} onError={setError} t={t} />
            )}
          </aside>
        )}
      </div>

      {editingHost && (
        <HostDialog
          host={editingHost}
          onSaved={(host) => void saveHostAndRefresh(host)}
          onCancel={() => setEditingHost(null)}
          onError={setError}
          t={t}
        />
      )}

      {deletingHost && (
        <ConfirmDialog
          title={t("confirmDelete", { name: hostLabel(deletingHost) })}
          hint={t("confirmDeleteHint")}
          confirmLabel={t("delete")}
          destructive
          onConfirm={() => void deleteHost(deletingHost)}
          onCancel={() => setDeletingHost(null)}
          t={t}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={persistSettings}
          onClose={() => setSettingsOpen(false)}
          t={t}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          hosts={hosts}
          snippets={snippets}
          commands={[
            { id: "local", label: t("localTerminal"), icon: CommandLineIcon },
            { id: "new-server", label: t("addServer"), icon: ServerStackIcon },
            { id: "split-right", label: t("splitRight"), icon: ViewColumnsIcon },
            { id: "split-down", label: t("splitDown"), icon: Squares2X2Icon },
            { id: "tunnels", label: t("tunnels"), icon: LinkIcon },
            { id: "snippets", label: t("snippets"), icon: BookmarkIcon },
            { id: "recordings", label: t("recordings"), icon: ClockIcon },
            { id: "settings", label: t("settings"), icon: Cog6ToothIcon },
          ]}
          canRunSnippets={activePane !== null}
          onPick={onPalettePick}
          onClose={() => setPaletteOpen(false)}
          t={t}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
