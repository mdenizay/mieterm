// One listener for the whole window, fanned out by session id.
//
// The obvious alternative is a listener per pane, but every pane would then be woken for
// every chunk of every other pane's output and filter it away. With a terminal that is a
// lot of wasted work on the hot path, so the single listener does the routing instead.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { decodeBase64 } from "./bytes";

type DataHandler = (bytes: Uint8Array) => void;
type ExitHandler = (code: number) => void;

const dataHandlers = new Map<string, DataHandler>();
const exitHandlers = new Map<string, ExitHandler>();

let started: Promise<UnlistenFn[]> | null = null;

function ensureStarted(): Promise<UnlistenFn[]> {
  if (!started) {
    started = Promise.all([
      listen<{ id: string; data: string }>("session:data", (event) => {
        const handler = dataHandlers.get(event.payload.id);
        if (handler) handler(decodeBase64(event.payload.data));
      }),
      listen<{ id: string; code: number }>("session:exit", (event) => {
        const handler = exitHandlers.get(event.payload.id);
        if (handler) handler(event.payload.code);
      }),
    ]);
  }
  return started;
}

/**
 * Resolves once the window is actually listening. A pane must await this before asking
 * the backend to open its session: `listen` is asynchronous, and output emitted before it
 * resolves would be dropped — which shows up as a terminal missing its first prompt.
 */
export function ready(): Promise<unknown> {
  return ensureStarted();
}

/** Registers a pane's handlers and returns the function that removes them. */
export function subscribe(id: string, onData: DataHandler, onExit: ExitHandler): () => void {
  dataHandlers.set(id, onData);
  exitHandlers.set(id, onExit);
  void ensureStarted();
  return () => {
    dataHandlers.delete(id);
    exitHandlers.delete(id);
  };
}
