// The window's only link to the agent core (the sidecar).
//
// Rust starts the core and reads its one "ready" line. This file asks Rust for
// that line, then speaks the core's local HTTP API (src/app.ts):
//   GET/POST /key  first launch: does the core need a Gemini key? hand it the pasted one
//   GET  /events   server-sent AgentEvents (the one event stream)
//   GET  /session  a short-lived LiveKit room token for the mic
//   POST /text     a typed turn
//   GET/POST /mode the safety mode; POST /jobs/:id/cancel the board's cancel button
//   GET  /setup, POST /setup/pick-folder|scan|save   the setup wizard (works before a key)
//   POST /chat/new end this chat (note + tidy job) and start the next
// Every call carries the per-launch token. Each command gets one small method
// here, so the rest of the window never builds URLs.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../../src/core/events.ts";
import type { SafetyMode } from "../../src/core/safety.ts";
import type { Config } from "../../src/config/index.ts";
import type { SetupAnswers } from "../../src/setup/index.ts";
import type { FolderTree, Part, PartChoice } from "./wizard-flow.ts";

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
  /** The safety mode now and the modes to offer, with their labels (first draw only; after that, `mode.changed` events). */
  getMode(): Promise<{ mode: SafetyMode; modes: { id: SafetyMode; label: string }[] }>;
  /** Switch the safety mode (`"cycle"` = Shift+Tab). The core announces it with `mode.changed`. */
  setMode(mode: SafetyMode | "cycle"): Promise<void>;
  /** The job board's cancel button. The board updates from the job's `job.state` events. */
  cancelJob(id: string): Promise<void>;
  /** New chat: the core saves this chat to the brain, tidies it on the job board, and starts fresh. */
  newChat(): Promise<void>;
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

/** Does the core still need a Gemini key (first launch, ticket 19)? Ask before `connectCore`. */
export async function keyNeeded(info: CoreInfo): Promise<boolean> {
  const res = await fetch(`${info.url}/key`, { headers: { Authorization: `Bearer ${info.launchToken}` } });
  if (!res.ok) throw new Error(`core /key: ${res.status}`);
  return ((await res.json()) as { needed: boolean }).needed;
}

/**
 * Hand the pasted key to the core, once. It checks it with Google, saves it and
 * starts the chat. Rejects with the core's plain reason for a bad key.
 * The key goes out in this one request and never comes back.
 */
export async function sendKey(info: CoreInfo, key: string): Promise<void> {
  const res = await fetch(`${info.url}/key`, {
    method: "POST",
    headers: { Authorization: `Bearer ${info.launchToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `core /key: ${res.status}`);
}

export interface SetupStatus {
  /** No config file yet: a first launch. */
  needed: boolean;
  /** No Gemini key yet: the wizard shows its key step. */
  keyNeeded: boolean;
  configPath: string;
  /** The config now (defaults on a first launch), to prefill the wizard. */
  current: Config;
}

// The setup wizard's calls. They need only the launch token, not a running chat.
async function setupCall<T>(info: CoreInfo, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${info.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${info.launchToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `core ${path}: ${res.status}`);
  return data;
}

/** Is setup needed (first launch, or no key)? And the config now. */
export const getSetup = (info: CoreInfo) => setupCall<SetupStatus>(info, "/setup");

/** The native macOS folder picker. Resolves null when cancelled. */
export async function pickFolder(info: CoreInfo): Promise<string | null> {
  const r = await setupCall<{ path?: string; cancelled?: boolean }>(info, "/setup/pick-folder", {});
  return r.path ?? null;
}

/**
 * The picker for one brain part: opens in the notes folder and resolves with the
 * pick relative to it (e.g. `notes/wiki`), or null when cancelled. Rejects for a
 * folder outside the notes folder.
 */
export async function pickPartFolder(info: CoreInfo, within: string): Promise<string | null> {
  const r = await setupCall<{ relative?: string; cancelled?: boolean }>(info, "/setup/pick-folder", { within });
  return r.relative ?? null;
}

/** A folder's top-level folders and counts (names only), and the brain parts they map to. */
export const scanFolder = (info: CoreInfo, path: string) =>
  setupCall<{ tree: FolderTree; parts: Record<Part, PartChoice> }>(info, "/setup/scan", { path });

/** Save the wizard's typed answers. Rejects with the core's plain reason (e.g. a missing folder). */
export const saveSetup = (info: CoreInfo, answers: SetupAnswers) => setupCall<{ config: Config }>(info, "/setup/save", answers);

/** The key screen's link: Rust opens Google AI Studio's key page in the browser (a fixed URL). */
export function openKeyPage(): Promise<void> {
  return invoke("open_key_page");
}

/** "Show log": Rust reveals <live-agent folder>/logs/core.log in Finder. Works even when the core is down. */
export function revealLog(): Promise<void> {
  return invoke<void>("reveal_log");
}

/** Mini mode: Rust shrinks the window to the orb (true) or restores it (false). */
export function setMiniWindow(on: boolean): Promise<void> {
  return invoke<void>("set_mini", { on });
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
    async getMode() {
      const res = await fetch(`${info.url}/mode`, { headers: auth });
      if (!res.ok) throw new Error(`core /mode: ${res.status}`);
      return (await res.json()) as { mode: SafetyMode; modes: { id: SafetyMode; label: string }[] };
    },
    async setMode(mode) {
      const res = await fetch(`${info.url}/mode`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(mode === "cycle" ? { cycle: true } : { mode }),
      });
      if (!res.ok) throw new Error(`core /mode: ${res.status}`);
    },
    async cancelJob(id) {
      const res = await fetch(`${info.url}/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: auth });
      if (!res.ok) throw new Error(`core cancel ${id}: ${res.status}`);
    },
    async newChat() {
      const res = await fetch(`${info.url}/chat/new`, { method: "POST", headers: auth });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `core /chat/new: ${res.status}`);
    },
  };
}
