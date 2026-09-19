import { useEffect, useState } from "react";
import {
  LinkIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import {
  asError,
  hostLabel,
  type AppError,
  type ForwardKind,
  type ForwardStatus,
  type Host,
  type PortForward,
} from "../lib/types";
import type { Translate } from "../lib/i18n";

interface Props {
  hosts: Host[];
  onError: (error: AppError) => void;
  t: Translate;
}

function emptyForward(hostId: string): PortForward {
  return {
    id: "",
    name: "",
    hostId,
    kind: "local",
    localPort: 8080,
    remoteHost: "127.0.0.1",
    remotePort: 80,
    autoStart: false,
  };
}

export function ForwardsPanel({ hosts, onError, t }: Props) {
  const [forwards, setForwards] = useState<PortForward[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ForwardStatus>>({});
  const [editing, setEditing] = useState<PortForward | null>(null);

  const reload = async () => {
    try {
      setForwards(await api.listForwards());
    } catch (e) {
      onError(asError(e));
    }
  };

  useEffect(() => {
    void reload();
    // The current state is asked for once — a tunnel may already have been running before
    // this panel was ever opened — and tracked by event afterwards.
    void api
      .forwardStatuses()
      .then((list) => setStatuses(Object.fromEntries(list.map((s) => [s.id, s]))))
      .catch(() => undefined);

    const unlisten = listen<ForwardStatus>("forward:status", (event) => {
      setStatuses((current) => ({ ...current, [event.payload.id]: event.payload }));
    });
    return () => {
      void unlisten.then((off) => off());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const describe = (forward: PortForward): string => {
    const host = hosts.find((h) => h.id === forward.hostId);
    const via = host ? hostLabel(host) : "?";
    if (forward.kind === "dynamic") return `SOCKS :${forward.localPort} → ${via}`;
    if (forward.kind === "remote") {
      return `${via}:${forward.remotePort} → ${forward.remoteHost}:${forward.localPort}`;
    }
    return `:${forward.localPort} → ${forward.remoteHost}:${forward.remotePort} (${via})`;
  };

  if (editing) {
    return (
      <ForwardEditor
        forward={editing}
        hosts={hosts}
        onSave={async (forward) => {
          try {
            await api.saveForward(forward);
            setEditing(null);
            await reload();
          } catch (e) {
            onError(asError(e));
          }
        }}
        onCancel={() => setEditing(null)}
        t={t}
      />
    );
  }

  return (
    <>
      <div className="drawer-toolbar">
        <button onClick={() => setEditing(emptyForward(hosts[0]?.id ?? ""))} disabled={hosts.length === 0}>
          <PlusIcon className="icon" />
          {t("newTunnel")}
        </button>
      </div>

      <div className="drawer-body">
        {forwards.length === 0 && (
          <div className="empty">
            <LinkIcon className="icon-xl" />
            <div>{t("tunnels")}</div>
            <div className="hint">{t("tunnelsHint")}</div>
          </div>
        )}

        <div className="list">
          {forwards.map((forward) => {
            const status = statuses[forward.id]?.state ?? "stopped";
            const message = statuses[forward.id]?.message;
            const live = status === "running" || status === "starting";
            return (
              <div key={forward.id} className="list-item">
                <LinkIcon
                  className="icon"
                  style={{ color: live ? "var(--success)" : "var(--text-faint)" }}
                />
                <span className="label">
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {forward.name || describe(forward)}
                    </span>
                    <span className={`badge ${status}`}>{t(status)}</span>
                  </div>
                  <div className="sub">{describe(forward)}</div>
                  {status === "failed" && message && <div className="bad">{message}</div>}
                </span>
                <span className="trailing">
                  <button
                    className="quiet"
                    title={live ? t("stop") : t("start")}
                    onClick={() =>
                      void (live ? api.stopForward(forward.id) : api.startForward(forward.id)).catch(
                        (e) => onError(asError(e)),
                      )
                    }
                  >
                    {live ? <StopIcon className="icon" /> : <PlayIcon className="icon" />}
                  </button>
                  <button className="quiet" title={t("edit")} onClick={() => setEditing(forward)}>
                    <PencilSquareIcon className="icon" />
                  </button>
                  <button
                    className="quiet"
                    title={t("delete")}
                    onClick={() =>
                      void api
                        .deleteForward(forward.id)
                        .then(reload)
                        .catch((e) => onError(asError(e)))
                    }
                  >
                    <TrashIcon className="icon" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ForwardEditor({
  forward: initial,
  hosts,
  onSave,
  onCancel,
  t,
}: {
  forward: PortForward;
  hosts: Host[];
  onSave: (forward: PortForward) => void;
  onCancel: () => void;
  t: Translate;
}) {
  const [forward, setForward] = useState(initial);
  const patch = (changes: Partial<PortForward>) =>
    setForward((current) => ({ ...current, ...changes }));

  return (
    <div className="drawer-form">
      <div className="field">
        <label>{t("name")}</label>
        <input value={forward.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>

      <div className="field">
        <label>{t("servers")}</label>
        <select value={forward.hostId} onChange={(e) => patch({ hostId: e.target.value })}>
          {hosts.map((host) => (
            <option key={host.id} value={host.id}>{hostLabel(host)}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{t("tunnelKind")}</label>
        <select value={forward.kind} onChange={(e) => patch({ kind: e.target.value as ForwardKind })}>
          <option value="local">{t("localForward")}</option>
          <option value="remote">{t("remoteForward")}</option>
          <option value="dynamic">{t("dynamicForward")}</option>
        </select>
      </div>

      <div className="row">
        <div className="field">
          <label>{t("localPort")}</label>
          <input
            type="number"
            value={forward.localPort}
            onChange={(e) => patch({ localPort: Number(e.target.value) || 0 })}
          />
        </div>
        {forward.kind !== "dynamic" && (
          <>
            <div className="field">
              <label>{t("destination")}</label>
              <input value={forward.remoteHost} onChange={(e) => patch({ remoteHost: e.target.value })} />
            </div>
            <div className="field">
              <label>{t("destinationPort")}</label>
              <input
                type="number"
                value={forward.remotePort}
                onChange={(e) => patch({ remotePort: Number(e.target.value) || 0 })}
              />
            </div>
          </>
        )}
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={forward.autoStart}
          onChange={(e) => patch({ autoStart: e.target.checked })}
        />
        {t("autoStart")}
      </label>

      <div className="row">
        <div className="spacer" />
        <button style={{ flex: "0 0 auto" }} onClick={onCancel}>{t("cancel")}</button>
        <button
          className="primary"
          style={{ flex: "0 0 auto" }}
          onClick={() => onSave(forward)}
          disabled={!forward.hostId}
        >
          {t("save")}
        </button>
      </div>
    </div>
  );
}
