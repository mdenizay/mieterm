import { useEffect, useState } from "react";
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
        <div className="dialog-head">{t("settings")}</div>

        <div className="dialog-body">
          <div className="group-label">{t("appearance")}</div>

          <div className="field">
            <label>{t("uiTheme")}</label>
            <div className="segmented">
              {(["system", "light", "dark"] as const).map((mode) => (
                <button
                  key={mode}
                  className={settings.uiTheme === mode ? "on" : ""}
                  onClick={() => patch({ uiTheme: mode })}
                >
                  {t(mode)}
                </button>
              ))}
            </div>
          </div>

          <div className="field field-row">
            <div>
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
            <div>
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

          <div className="field field-row">
            <div style={{ flex: 3 }}>
              <label>{t("font")}</label>
              <input
                value={settings.fontFamily}
                onChange={(e) => patch({ fontFamily: e.target.value })}
              />
            </div>
            <div style={{ flex: 1 }}>
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

          <div className="group-label">{t("terminal")}</div>

          <div className="field field-row">
            <div>
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
            <div>
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
            <div>
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

          <label className="checkbox" style={{ marginBottom: 7 }}>
            <input
              type="checkbox"
              checked={settings.cursorBlink}
              onChange={(e) => patch({ cursorBlink: e.target.checked })}
            />
            <span>{t("blink")}</span>
          </label>
          <label className="checkbox" style={{ marginBottom: 7 }}>
            <input
              type="checkbox"
              checked={settings.copyOnSelect}
              onChange={(e) => patch({ copyOnSelect: e.target.checked })}
            />
            <span>{t("copyOnSelect")}</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.recordSessions}
              onChange={(e) => patch({ recordSessions: e.target.checked })}
            />
            <span>{t("recordSessions")}</span>
          </label>

          {diagnostics && (
            <>
              <div className="group-label">{t("about")}</div>
              <div className="row-sub">
                {t("version")}: {diagnostics.version} · {diagnostics.platform}
              </div>
              <div className="row-sub">
                {t("sshClient")}: {diagnostics.sshPath}
              </div>
              <div className="row-sub">
                {t("dataFolder")}: {diagnostics.dataDir}
              </div>
            </>
          )}
        </div>

        <div className="dialog-foot">
          <button className="primary" onClick={onClose}>{t("close")}</button>
        </div>
      </div>
    </div>
  );
}
