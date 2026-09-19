import { ArrowDownTrayIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { Translate } from "../lib/i18n";
import type { UpdateStage } from "../lib/useUpdater";

interface Props {
  stage: UpdateStage;
  dismissed: boolean;
  t: Translate;
  onDismiss: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

/**
 * The only place an update interrupts anything, and it never does more than occupy a strip
 * at the top. Nothing here restarts the app without a click — there are live terminal
 * sessions behind this banner.
 */
export function UpdateBanner({ stage, dismissed, t, onDismiss, onDownload, onInstall }: Props) {
  if (dismissed) return null;

  switch (stage.kind) {
    case "available":
      return (
        <div className="update-banner">
          <ArrowDownTrayIcon className="icon" />
          <span>{t("updateAvailable", { version: stage.version })}</span>
          <button className="primary" onClick={onDownload}>{t("updateDownload")}</button>
          <div className="spacer" />
          <button className="quiet" onClick={onDismiss}>
            <XMarkIcon className="icon" />
          </button>
        </div>
      );
    case "downloading":
      return (
        <div className="update-banner">
          <ArrowDownTrayIcon className="icon" />
          <span>{t("updateDownloading", { version: stage.version })}</span>
          <div className="progress"><div style={{ width: `${stage.percent}%` }} /></div>
          <span className="hint">{stage.percent}%</span>
        </div>
      );
    case "ready":
      return (
        <div className="update-banner">
          <ArrowDownTrayIcon className="icon" />
          <span>{t("updateReady", { version: stage.version })}</span>
          <button className="primary" onClick={onInstall}>{t("updateRestart")}</button>
          <div className="spacer" />
          <button className="quiet" onClick={onDismiss}>{t("updateOnNextLaunch")}</button>
        </div>
      );
    case "installing":
      return (
        <div className="update-banner">
          <span>{t("updateInstalling")}</span>
        </div>
      );
    default:
      // Idle, checking, none and failed stay silent here; the result of a check is shown
      // in Settings rather than shoved in front of someone who is working.
      return null;
  }
}
