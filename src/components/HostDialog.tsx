import { useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { asError, HOST_COLORS, type AppError, type Host } from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  host: Host;
  onSaved: (host: Host) => void;
  onCancel: () => void;
  onError: (error: AppError) => void;
  t: Translate;
}

export function HostDialog({ host: initial, onSaved, onCancel, onError, t }: Props) {
  const [host, setHost] = useState<Host>(initial);
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  // A saved secret is never read back into the form; the field stays blank and the
  // placeholder says so, which is the only honest way to show a keychain entry.
  const [hasPassword, setHasPassword] = useState(false);
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial.id) return;
    void api.hasSecret(initial.id, "password").then(setHasPassword).catch(() => undefined);
    void api.hasSecret(initial.id, "passphrase").then(setHasPassphrase).catch(() => undefined);
  }, [initial.id]);

  const patch = (changes: Partial<Host>) => setHost((current) => ({ ...current, ...changes }));

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await api.saveHost(host);
      if (password) await api.setSecret(saved.id, "password", password);
      if (passphrase) await api.setSecret(saved.id, "passphrase", passphrase);
      onSaved(saved);
    } catch (e) {
      onError(asError(e));
      setSaving(false);
    }
  };

  const pickKey = async () => {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: t("privateKey"),
    });
    if (typeof selected === "string") patch({ keyPath: selected });
  };

  return (
    <div className="scrim" onMouseDown={onCancel}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">{initial.id ? t("editServer") : t("newServer")}</div>

        <div className="dialog-body">
          <div className="field">
            <label>{t("name")}</label>
            <input
              autoFocus
              value={host.name}
              placeholder={host.hostname || "Production web"}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>

          <div className="field field-row">
            <div style={{ flex: 3 }}>
              <label>{t("hostname")}</label>
              <input
                value={host.hostname}
                placeholder="example.com"
                onChange={(e) => patch({ hostname: e.target.value })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>{t("port")}</label>
              <input
                type="number"
                value={host.port}
                onChange={(e) => patch({ port: Number(e.target.value) || 22 })}
              />
            </div>
          </div>

          <div className="field">
            <label>{t("username")}</label>
            <input
              value={host.username}
              placeholder="root"
              onChange={(e) => patch({ username: e.target.value })}
            />
          </div>

          <div className="field">
            <label>{t("authentication")}</label>
            <select value={host.auth} onChange={(e) => patch({ auth: e.target.value as Host["auth"] })}>
              <option value="agent">{t("agentAuth")}</option>
              <option value="password">{t("passwordAuth")}</option>
              <option value="key">{t("keyAuth")}</option>
            </select>
          </div>

          {host.auth === "password" && (
            <div className="field">
              <label>{t("password")}</label>
              <input
                type="password"
                value={password}
                placeholder={hasPassword ? t("leaveBlankUnchanged") : ""}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="hint">{t("savedInKeychain")}</div>
            </div>
          )}

          {host.auth === "key" && (
            <>
              <div className="field">
                <label>{t("privateKey")}</label>
                <div style={{ display: "flex", gap: 7 }}>
                  <input
                    value={host.keyPath}
                    placeholder="~/.ssh/id_ed25519"
                    onChange={(e) => patch({ keyPath: e.target.value })}
                  />
                  <button onClick={pickKey} style={{ flex: "0 0 auto" }}>{t("choose")}</button>
                </div>
              </div>
              <div className="field">
                <label>{t("passphrase")}</label>
                <input
                  type="password"
                  value={passphrase}
                  placeholder={hasPassphrase ? t("leaveBlankUnchanged") : ""}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
                <div className="hint">{t("savedInKeychain")}</div>
              </div>
            </>
          )}

          <div className="field field-row">
            <div>
              <label>{t("tags")}</label>
              <input
                value={host.tags.join(", ")}
                placeholder="production, eu-west"
                onChange={(e) =>
                  patch({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                }
              />
              <div className="hint">{t("tagsHint")}</div>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <label>{t("colour")}</label>
              <div className="swatches">
                {HOST_COLORS.map((colour) => (
                  <button
                    key={colour}
                    className={`swatch${host.color === colour ? " selected" : ""}`}
                    style={{ background: `var(--dot-${colour})` }}
                    onClick={() => patch({ color: colour })}
                    title={colour}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <label>{t("startupCommand")}</label>
            <input
              value={host.startupCommand}
              placeholder="cd /var/www && ls"
              onChange={(e) => patch({ startupCommand: e.target.value })}
            />
          </div>

          <div className="field">
            <label>{t("extraArgs")}</label>
            <input
              value={host.extraArgs}
              placeholder="-J jump.example.com"
              onChange={(e) => patch({ extraArgs: e.target.value })}
            />
            <div className="hint">{t("extraArgsHint")}</div>
          </div>

          <div className="field">
            <label>{t("notes")}</label>
            <textarea rows={2} value={host.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </div>
        </div>

        <div className="dialog-foot">
          <button onClick={onCancel}>{t("cancel")}</button>
          <button className="primary" onClick={submit} disabled={!host.hostname.trim() || saving}>
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
