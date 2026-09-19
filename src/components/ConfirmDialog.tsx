import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
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

export function ConfirmDialog({
  title,
  hint,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
  t,
}: Props) {
  return (
    <div className="scrim" onMouseDown={onCancel}>
      <div className="dialog" style={{ width: 400 }} onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          {destructive && <ExclamationTriangleIcon className="icon" style={{ color: "var(--danger)" }} />}
          {title}
        </h2>
        {hint && <div className="dialog-body"><div className="hint">{hint}</div></div>}
        <div className="dialog-footer">
          <div className="spacer" />
          <button onClick={onCancel}>{t("cancel")}</button>
          <button className={destructive ? "danger" : "primary"} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
