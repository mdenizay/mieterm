import type { Translate } from "../lib/i18n";

interface Props {
  title: string;
  hint?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  t: Translate;
}

export function ConfirmDialog({ title, hint, confirmLabel, destructive, onConfirm, onCancel, t }: Props) {
  return (
    <div className="scrim" onMouseDown={onCancel}>
      <div className="dialog" style={{ maxWidth: 380 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">{title}</div>
        {hint && <div className="dialog-body" style={{ color: "var(--text-muted)" }}>{hint}</div>}
        <div className="dialog-foot">
          <button onClick={onCancel}>{t("cancel")}</button>
          <button
            className={destructive ? "primary" : "primary"}
            style={destructive ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" } : undefined}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
