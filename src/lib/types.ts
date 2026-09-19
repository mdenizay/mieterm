// Mirrors src-tauri/src/models.rs. Kept hand-written rather than generated: the file is
// small, and a mismatch shows up as a type error here rather than at runtime.

export type AuthMethod = "agent" | "password" | "key";

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth: AuthMethod;
  keyPath: string;
  tags: string[];
  color: string;
  startupCommand: string;
  extraArgs: string;
  notes: string;
}

export interface Snippet {
  id: string;
  name: string;
  command: string;
  tags: string[];
  noNewline: boolean;
}

export type ForwardKind = "local" | "remote" | "dynamic";

export interface PortForward {
  id: string;
  name: string;
  hostId: string;
  kind: ForwardKind;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  autoStart: boolean;
}

export type ForwardState = "starting" | "running" | "failed" | "stopped";

export interface ForwardStatus {
  id: string;
  state: ForwardState;
  message: string;
}

export interface Settings {
  uiTheme: "system" | "light" | "dark";
  terminalTheme: string;
  fontFamily: string;
  fontSize: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  recordSessions: boolean;
  copyOnSelect: boolean;
  keepaliveSeconds: number;
  language: "en" | "tr";
}

export interface RemoteFile {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  permissions: string;
  modified: number;
}

export interface Recording {
  id: string;
  title: string;
  startedAt: string;
  bytes: number;
}

export interface RecordingMatch {
  id: string;
  title: string;
  lineNumber: number;
  line: string;
}

export interface Diagnostics {
  version: string;
  dataDir: string;
  sshPath: string;
  platform: string;
}

/** What every failing command rejects with. */
export interface AppError {
  message: string;
  detail?: string;
}

export function asError(error: unknown): AppError {
  if (error && typeof error === "object" && "message" in error) {
    return error as AppError;
  }
  return { message: String(error) };
}

export const HOST_COLORS = [
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "gray",
] as const;

export function emptyHost(): Host {
  return {
    id: "",
    name: "",
    hostname: "",
    port: 22,
    username: "",
    auth: "agent",
    keyPath: "",
    tags: [],
    color: HOST_COLORS[Math.floor(Math.random() * HOST_COLORS.length)],
    startupCommand: "",
    extraArgs: "",
    notes: "",
  };
}

export function hostLabel(host: Host): string {
  if (host.name) return host.name;
  return host.username ? `${host.username}@${host.hostname}` : host.hostname;
}

export function hostSubtitle(host: Host): string {
  const user = host.username ? `${host.username}@` : "";
  return `${user}${host.hostname}${host.port === 22 ? "" : `:${host.port}`}`;
}

/** The command you would type to reach this server, for the one-click copy. */
export function sshCommand(host: Host): string {
  const port = host.port === 22 ? "" : ` -p ${host.port}`;
  const key = host.auth === "key" && host.keyPath ? ` -i ${host.keyPath}` : "";
  const user = host.username ? `${host.username}@` : "";
  return `ssh${port}${key} ${user}${host.hostname}`;
}
