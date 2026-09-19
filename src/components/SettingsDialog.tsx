import { useEffect, useState } from "react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { api } from "../lib/api";
import { TERMINAL_THEMES } from "../lib/themes";
import type { Diagnostics, Settings } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
  t: Translate;
}

export function SettingsDialog({ settings: initial, onSave, onClose, t }: Props) {
  const [settings, setSettings] = useState(initial);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    void api.diagnostics().then(setDiagnostics).catch(() => undefined);
  }, []);

  const patch = (changes: Partial<Settings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    // Applied as you change it: a theme or font you cannot see until you press Save is a
    // setting you end up guessing at.
    onSave(next);
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          <Cog6ToothIcon className="icon" />
          {t("settings")}
        </h2>

        <div className="dialog-body">
          <div className="section-title">{t("appearance")}</div>

          <div className="row">
            <div className="field">
              <label>{t("uiTheme")}</label>
              <select
                value={settings.uiTheme}
                onChange={(e) => patch({ uiTheme: e.target.value as Settings["uiTheme"] })}
              >
                <option value="system">{t("system")}</option>
                <option value="light">{t("light")}</option>
                <option value="dark">{t("dark")}</option>
              </select>
            </div>
            <div className="field">
              <label>{t("theme")}</label>
              <select
                value={settings.terminalTheme}
                onChange={(e) => patch({ terminalTheme: e.target.value })}
              >
                {TERMINAL_THEMES.map((theme) => (
                  <option key={theme.name} value={theme.name}>{theme.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("language")}</label>
              <select
                value={settings.language}
                onChange={(e) => patch({ language: e.target.value as Settings["language"] })}
              >
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
          </div>

          <div className="row">
            <div className="field" style={{ flex: 3 }}>
              <label>{t("font")}</label>
              <input value={settings.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>{t("fontSize")}</label>
              <input
                type="number"
                min={8}
                max={32}
                value={settings.fontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) || 13 })}
              />
            </div>
          </div>

          <div className="section-title">{t("terminal")}</div>

          <div className="row">
            <div className="field">
              <label>{t("cursor")}</label>
              <select
                value={settings.cursorStyle}
                onChange={(e) => patch({ cursorStyle: e.target.value as Settings["cursorStyle"] })}
              >
                <option value="bar">{t("bar")}</option>
                <option value="block">{t("block")}</option>
                <option value="underline">{t("underline")}</option>
              </select>
            </div>
            <div className="field">
              <label>{t("scrollback")}</label>
              <input
                type="number"
                min={500}
                max={200000}
                step={500}
                value={settings.scrollback}
                onChange={(e) => patch({ scrollback: Number(e.target.value) || 5000 })}
              />
            </div>
            <div className="field">
              <label>{t("keepalive")}</label>
              <input
                type="number"
                min={5}
                max={600}
                value={settings.keepaliveSeconds}
                onChange={(e) => patch({ keepaliveSeconds: Number(e.target.value) || 30 })}
              />
            </div>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={settings.cursorBlink}
              onChange={(e) => patch({ cursorBlink: e.target.checked })}
            />
            {t("blink")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.copyOnSelect}
              onChange={(e) => patch({ copyOnSelect: e.target.checked })}
            />
            {t("copyOnSelect")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.recordSessions}
              onChange={(e) => patch({ recordSessions: e.target.checked })}
            />
            {t("recordSessions")}
          </label>

          {diagnostics && (
            <>
              <div className="section-title">{t("about")}</div>
              <div className="hint">
                {t("version")}: {diagnostics.version} · {diagnostics.platform}
              </div>
              <div className="hint">
                {t("sshClient")}: {diagnostics.sshPath}
              </div>
              <div className="hint">
                {t("dataFolder")}: {diagnostics.dataDir}
              </div>
            </>
          )}
        </div>

        <div className="dialog-footer">
          <div className="spacer" />
          <button className="primary" onClick={onClose}>{t("close")}</button>
        </div>
      </div>
    </div>
  );
}
