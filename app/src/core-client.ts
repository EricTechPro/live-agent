// The window's only link to the agent core (the sidecar).
//
// Rust starts the core and reads its one "ready" line. This file asks Rust for
// that line, then speaks the core's local HTTP API (src/app.ts):
//   GET  /events   server-sent AgentEvents (the one event stream)
//   GET  /session  a short-lived LiveKit room token for the mic
//   POST /text     a typed turn
// Every call carries the per-launch token. New commands (cancel job, set mode)
// get one small method here each, so the rest of the window never builds URLs.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../../src/core/events.ts";

export interface CoreInfo {
  url: string;
  launchToken: string;
}

export interface RoomSession {
  livekitUrl: string;
  token: string;
  identity: string;
  room: string;
  expiresAt: string;
}

export interface CoreClient {
  info: CoreInfo;
  /** Every event from the core, live. Returns an unsubscribe function. */
  onEvent(cb: (event: AgentEvent) => void): () => void;
  /** A LiveKit room token for joining as "user" (expires in ~10 min; ask again to reconnect). */
  session(): Promise<RoomSession>;
  /** Send a typed turn. Rejects if a turn is already running (409). */
  sendText(text: string): Promise<void>;
}

/** Wait for Rust to report the core is up. Rejects with the reason if it failed to start. */
export async function waitForCore(): Promise<CoreInfo> {
  for (;;) {
    const status = await invoke<{ state: "starting" | "ready" | "down"; info?: CoreInfo; reason?: string }>("core_status");
    if (status.state === "ready" && status.info) return status.info;
    if (status.state === "down") throw new Error(status.reason ?? "the core stopped");
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Called once if the core process dies after starting. */
export function onCoreDown(cb: (reason: string) => void) {
  return listen<string>("core-down", (e) => cb(e.payload));
}

export function connectCore(info: CoreInfo): CoreClient {
  const auth = { Authorization: `Bearer ${info.launchToken}` };
  const listeners = new Set<(event: AgentEvent) => void>();
  // EventSource can't set headers; /events alone accepts the token in the query.
  const source = new EventSource(`${info.url}/events?token=${info.launchToken}`);
  source.onmessage = (m) => {
    const event = JSON.parse(m.data) as AgentEvent;
    for (const cb of listeners) cb(event);
  };

  return {
    info,
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async session() {
      const res = await fetch(`${info.url}/session`, { headers: auth });
      if (!res.ok) throw new Error(`core /session: ${res.status}`);
      return (await res.json()) as RoomSession;
    },
    async sendText(text) {
      const res = await fetch(`${info.url}/text`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `core /text: ${res.status}`);
    },
  };
}
