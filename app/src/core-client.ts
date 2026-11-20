// The window's only link to the agent core (the sidecar).
//
// Rust starts the core and reads its one "ready" line. This file asks Rust for
// that line, then speaks the core's local HTTP API (src/app.ts):
//   GET/POST /key  first launch: does the core need a Gemini key? hand it the pasted one
//   GET  /events   server-sent AgentEvents (the one event stream)
//   GET  /session  a short-lived LiveKit room token for the mic
//   POST /text     a typed turn
//   GET/POST /mode the safety mode; POST /jobs/:id/cancel the board's cancel button
//   POST /approvals/:id/approve|decline  the approve / deny card (ticket 28)
//   GET  /setup, POST /setup/pick-folder|scan|save   the setup wizard (works before a key)
//   POST /chat/new end this chat (note + tidy job) and start the next
//   POST /reply/stop  Esc: stop the reply being spoken (ticket 37)
//   GET  /brain/tree, /brain/file?path=   the sidebar's brain tree and the read-only file view (ticket 23)
//   GET  /brain/chats  the sidebar's past chats (ticket 24)
//   POST /duck  push to talk held / let go; POST /reminders/done  the Reminders card's ring
//   GET  /memory, POST /memory/forget  the Brain tab's "What I remember"
// Every call carries the per-launch token. Each command gets one small method
// here, so the rest of the window never builds URLs.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../../src/core/events.ts";
import type { Fact } from "../../src/brain/memory.ts";
import type { SafetyMode } from "../../src/core/safety.ts";
import type { Config } from "../../src/config/index.ts";
import type { SetupAnswers } from "../../src/setup/index.ts";
import type { BrainTree } from "../../src/brain/tree.ts";
import type { PastChat } from "../../src/brain/chats.ts";
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
  /** The approve / deny card (ticket 28): the same as a spoken yes or no for one waiting call. Rejects if it was already answered. */
  answerCall(id: string, approve: boolean): Promise<void>;
  /** New chat: the core saves this chat to the brain, tidies it on the job board, and starts fresh. */
  newChat(): Promise<void>;
  /** Pause (true) or resume: Jett stops speaking and hearing; the chat stays. The core echoes a `paused` event. */
  pause(on: boolean): Promise<void>;
  /** Esc (ticket 37): stop the reply being spoken; the call stays on. The core sends `interrupted`. */
  stopReply(): Promise<void>;
  /** Retry (ticket 40): no network, try to reach Gemini now instead of after the backoff. */
  reconnect(): Promise<void>;
  /** The brain's three parts as a file tree (ticket 23). */
  brainTree(): Promise<BrainTree>;
  /** One note's text, read only. Rejects with the core's plain reason (outside the brain, gone). */
  brainFile(path: string): Promise<{ path: string; text: string; truncated?: boolean }>;
  /** Past chats, newest first: the chat-end notes in raw (ticket 24). */
  pastChats(): Promise<PastChat[]>;
  /** Push to talk held or let go: the core turns the Mac's other sounds down meanwhile. */
  duck(on: boolean): Promise<void>;
  /** The Reminders card's ring checkbox: tick one off. The card follows the `reminders` event. */
  doneReminder(id: string): Promise<void>;
  /** "What I remember" (the Brain tab), and its Forget. */
  memory(): Promise<Fact[]>;
  forget(id: string): Promise<Fact[]>;
}

type CoreStatus = { state: "starting" | "ready" | "restarting" | "down"; info?: CoreInfo; reason?: string; attempt?: number; retryInMs?: number };

/**
 * Wait for Rust to report the core is up. Rejects with the reason only when the shell has
 * given up restarting it (ticket 40); while it restarts, `onRestart` hears each try.
 */
export async function waitForCore(onRestart?: (attempt: number, retryInMs: number) => void): Promise<CoreInfo> {
  let seen = 0;
  for (;;) {
    const status = await invoke<CoreStatus>("core_status");
    if (status.state === "ready" && status.info) return status.info;
    if (status.state === "down") throw new Error(status.reason ?? "the core stopped");
    if (status.state === "restarting" && status.attempt !== seen) {
      seen = status.attempt ?? 0;
      onRestart?.(seen, status.retryInMs ?? 0);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The window's Retry once the shell stopped restarting the core by itself (ticket 40). */
export function restartCore(): Promise<void> {
  return invoke<void>("restart_core");
}

/** The core died and the shell starts it again in `retryInMs` (ticket 40). */
export function onCoreRestarting(cb: (r: { attempt: number; retryInMs: number; reason: string }) => void) {
  return listen<{ attempt: number; retryInMs: number; reason: string }>("core-restarting", (e) => cb(e.payload));
}

/** A (re)started core is up at a new address (ticket 40). */
export function onCoreReady(cb: (info: CoreInfo) => void) {
  return listen<CoreInfo>("core-ready", (e) => cb(e.payload));
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

/**
 * One poll of the overlay (tickets 36, 37): the cursor inside the window in CSS pixels
 * (null when it is outside), whether Ctrl+Option is held (push to talk), and whether the
 * left mouse button is down (ticket 40: a drag ends when it is not).
 */
export function overlayPoll(): Promise<{ point: [number, number] | null; talkKeys: boolean; mouseDown: boolean; escape?: boolean }> {
  return invoke("overlay_poll");
}

/** The menu-bar icon asks to open the panel. */
export function onOpenPanel(cb: () => void) {
  return listen("open-panel", () => cb());
}

/** Ctrl+Option+S or the menu-bar item (ticket 38): minimise Jett to its dot, or bring it back. */
export function onToggleMini(cb: () => void) {
  return listen("toggle-mini", () => cb());
}

/** The menu-bar "New chat" item (ticket 39). */
export function onNewChat(cb: () => void) {
  return listen("new-chat", () => cb());
}

/** Ctrl+Option+T (ticket 40): open the quick type field (Rust already gave the window the keyboard). */
export function onQuickType(cb: () => void) {
  return listen("quick-type", () => cb());
}

/** The quick type field opened (take the keyboard) or closed (give it back to the app before). */
export function quickTypeFocus(on: boolean): Promise<void> {
  return invoke<void>("quick_type_focus", { on });
}

/** The hold-to-draw keys (ticket 45): Rust's poll reports them held as `talkKeys`. */
export function setDrawHotkey(mods: string[], key?: string): Promise<void> {
  return invoke<void>("set_draw_hotkey", { mods, key: key ?? null });
}

/** The menu-bar "Shortcuts" item (ticket 38). */
export function onShowShortcuts(cb: () => void) {
  return listen("show-shortcuts", () => cb());
}

/** Tell the menu bar whether Jett is shown or minimised, so its item says Hide or Show. */
export function setTrayShown(shown: boolean): Promise<void> {
  return invoke<void>("set_tray_shown", { shown });
}

/** Click-through on (clicks reach the apps below) or off (the window takes the mouse). */
export function setClickThrough(on: boolean): Promise<void> {
  return invoke<void>("set_click_through", { on });
}

/** Running inside the Tauri app (not a plain browser preview). */
export const inTauri = () => "__TAURI_INTERNALS__" in window;

/** The core process died and the shell gave up restarting it (ticket 40: Retry then). */
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
    async pause(on) {
      const res = await fetch(`${info.url}/pause`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ paused: on }),
      });
      if (!res.ok) throw new Error(`core /pause: ${res.status}`);
    },
    async stopReply() {
      const res = await fetch(`${info.url}/reply/stop`, { method: "POST", headers: auth });
      if (!res.ok) throw new Error(`core /reply/stop: ${res.status}`);
    },
    async reconnect() {
      const res = await fetch(`${info.url}/reconnect`, { method: "POST", headers: auth });
      if (!res.ok) throw new Error(`core /reconnect: ${res.status}`);
    },
    async answerCall(id, approve) {
      const res = await fetch(`${info.url}/approvals/${encodeURIComponent(id)}/${approve ? "approve" : "decline"}`, { method: "POST", headers: auth });
      if (!res.ok) throw new Error(`core answer ${id}: ${res.status}`);
    },
    async newChat() {
      const res = await fetch(`${info.url}/chat/new`, { method: "POST", headers: auth });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `core /chat/new: ${res.status}`);
    },
    brainTree: () => setupCall<BrainTree>(info, "/brain/tree"),
    brainFile: (path) => setupCall(info, `/brain/file?path=${encodeURIComponent(path)}`),
    pastChats: async () => (await setupCall<{ chats: PastChat[] }>(info, "/brain/chats")).chats,
    async duck(on) {
      await setupCall(info, "/duck", { on });
    },
    async doneReminder(id) {
      await setupCall(info, "/reminders/done", { id });
    },
    memory: async () => (await setupCall<{ facts: Fact[] }>(info, "/memory")).facts,
    forget: async (id) => (await setupCall<{ facts: Fact[] }>(info, "/memory/forget", { id })).facts,
  };
}
