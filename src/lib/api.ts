// One typed wrapper per command, so the invoke strings live in a single file and a rename
// on the Rust side is one compile error here rather than a runtime surprise.

import { invoke } from "@tauri-apps/api/core";
import type {
  Diagnostics,
  ForwardStatus,
  Host,
  PortForward,
  Recording,
  RecordingMatch,
  RemoteFile,
  Settings,
  Snippet,
} from "./types";

export const api = {
  listHosts: () => invoke<Host[]>("list_hosts"),
  saveHost: (host: Host) => invoke<Host>("save_host", { host }),
  deleteHost: (id: string) => invoke<void>("delete_host", { id }),
  reorderHosts: (ids: string[]) => invoke<Host[]>("reorder_hosts", { ids }),

  setSecret: (hostId: string, kind: "password" | "passphrase", secret: string) =>
    invoke<void>("set_secret", { hostId, kind, secret }),
  hasSecret: (hostId: string, kind: "password" | "passphrase") =>
    invoke<boolean>("has_secret", { hostId, kind }),
  deleteSecret: (hostId: string, kind: "password" | "passphrase") =>
    invoke<void>("delete_secret", { hostId, kind }),

  listSnippets: () => invoke<Snippet[]>("list_snippets"),
  saveSnippet: (snippet: Snippet) => invoke<Snippet>("save_snippet", { snippet }),
  deleteSnippet: (id: string) => invoke<void>("delete_snippet", { id }),

  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),

  openSession: (args: {
    id: string;
    hostId: string | null;
    cols: number;
    rows: number;
    cwd?: string | null;
  }) => invoke<void>("open_session", { ...args, cwd: args.cwd ?? null }),
  writeSession: (id: string, data: string) => invoke<void>("write_session", { id, data }),
  broadcastSession: (ids: string[], data: string) =>
    invoke<void>("broadcast_session", { ids, data }),
  resizeSession: (id: string, cols: number, rows: number) =>
    invoke<void>("resize_session", { id, cols, rows }),
  closeSession: (id: string) => invoke<void>("close_session", { id }),

  listForwards: () => invoke<PortForward[]>("list_forwards"),
  saveForward: (forward: PortForward) => invoke<PortForward>("save_forward", { forward }),
  deleteForward: (id: string) => invoke<void>("delete_forward", { id }),
  startForward: (id: string) => invoke<void>("start_forward", { id }),
  stopForward: (id: string) => invoke<void>("stop_forward", { id }),
  forwardStatuses: () => invoke<ForwardStatus[]>("forward_statuses"),

  sftpConnect: (hostId: string) => invoke<string>("sftp_connect", { hostId }),
  sftpDisconnect: (id: string) => invoke<void>("sftp_disconnect", { id }),
  sftpHome: (id: string) => invoke<string>("sftp_home", { id }),
  sftpList: (id: string, path: string) => invoke<RemoteFile[]>("sftp_list", { id, path }),
  sftpDownload: (id: string, remote: string, local: string) =>
    invoke<number>("sftp_download", { id, remote, local }),
  sftpUpload: (id: string, local: string, remote: string) =>
    invoke<number>("sftp_upload", { id, local, remote }),
  sftpMkdir: (id: string, path: string) => invoke<void>("sftp_mkdir", { id, path }),
  sftpRename: (id: string, from: string, to: string) =>
    invoke<void>("sftp_rename", { id, from, to }),
  sftpRemove: (id: string, path: string, isDir: boolean) =>
    invoke<void>("sftp_remove", { id, path, isDir }),

  listRecordings: () => invoke<Recording[]>("list_recordings"),
  readRecording: (id: string) => invoke<string>("read_recording", { id }),
  deleteRecording: (id: string) => invoke<void>("delete_recording", { id }),
  searchRecordings: (query: string) => invoke<RecordingMatch[]>("search_recordings", { query }),

  diagnostics: () => invoke<Diagnostics>("diagnostics"),
};
