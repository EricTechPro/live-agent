// Jett's hands: the core's side of computer control (Roamies-style, our own code).
//
// The jett-eyes helper (app/src-tauri/eyes/main.swift) does the clicking, typing, keys,
// scrolling, window list and focus, one command per run, one JSON line back. `open` is
// macOS's own `open`, spawned with an argv array (never a shell), after `openArgv` checks it.
// Input commands need Accessibility: without it the helper exits 3 and we throw
// AccessibilityOffError, whose message tells the user how to turn it on.
//
// Idea from Roamies (AGPL): idea only, our own code.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { run } from "./eyes.ts";
import type { Pt, Rect } from "./geometry.ts";

export interface AppInfo {
  app: string;
  bundleId?: string;
  pid: number;
  active?: boolean;
  hidden?: boolean;
}

export interface WindowInfo {
  app: string;
  pid: number;
  /** Missing without Screen Recording. */
  title?: string;
  bounds?: Rect;
  windowId?: number;
}

export type ScrollDirection = "up" | "down" | "left" | "right";

export interface Hands {
  /** Is Accessibility on for Jett? Clicks, typing, keys and scrolls need it. */
  trusted(): Promise<boolean>;
  /** Running apps (with a Dock icon) and on-screen windows, front to back. */
  windows(): Promise<{ apps: AppInfo[]; windows: WindowInfo[] }>;
  /** Bring a running app to the front (by name or bundle id). Throws when it is not running. */
  focus(app: string): Promise<AppInfo>;
  /** Press the control at a point (global points): Accessibility press, else a real click there. */
  press(at: Pt, pid?: number): Promise<{ via: "ax" | "mouse"; role?: string; label?: string }>;
  clickAt(at: Pt, options?: { right?: boolean; count?: number }): Promise<void>;
  /** Type text as keyboard input into whatever has focus. "\n" presses Return. */
  type(text: string): Promise<void>;
  /** A key or combo: "return", "tab", "cmd+t", "cmd+shift+n". */
  key(combo: string): Promise<void>;
  /** Scroll by lines, at a point (global points) or wherever the pointer is. */
  scroll(direction: ScrollDirection, amount: number, at?: Pt): Promise<void>;
  /** Run macOS `open` with an argv from `openArgv`. */
  open(argv: string[]): Promise<void>;
}

export class AccessibilityOffError extends Error {
  constructor() {
    super(
      "Accessibility is off for Jett, so I can't click or type in other apps. Turn it on in System Settings > " +
        "Privacy & Security > Accessibility, then try again.",
    );
    this.name = "AccessibilityOffError";
  }
}

// ---- open: checked argv (test/computer-control.test.ts) ----------------------------------

export interface OpenRequest {
  /** An app name ("Safari"), a web address ("https://..." or "skool.com/x"), or a file or folder path. */
  target: string;
  /** Open the address or file in this app ("Google Chrome"). */
  app?: string;
  /** Launch without bringing it to the front (`open -g`). */
  background?: boolean;
}

// App names: letters, digits, spaces and a few marks real app names use. No shell bits.
const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .&'()+_-]{0,79}$/u;
const SCHEMES = new Set(["http", "https", "mailto", "tel", "facetime", "maps", "x-apple.systempreferences"]);
// "skool.com", "www.bbc.co.uk/news": a dot, a known-looking top-level part, no spaces.
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

/** A checked app name ("Notes.app" -> "Notes"), or a throw. */
export function appName(name: string): string {
  const n = name.trim().replace(/\.app$/i, "");
  if (!APP_NAME.test(n)) throw new Error(`"${name}" is not an app name I can open.`);
  return n;
}

/** The argv for macOS `open`, or a throw saying why not. Never starts a shell. */
export function openArgv({ target, app, background }: OpenRequest): string[] {
  const t = (target ?? "").trim();
  if (!t) throw new Error("Say what to open: an app name, a web address, or a file or folder path.");
  if (t.startsWith("-")) throw new Error(`"${t}" looks like a flag, not something to open.`);
  if (/[\0\n\r]/.test(t)) throw new Error("That has control characters in it.");
  const head = ["open", ...(background ? ["-g"] : []), ...(app ? ["-a", appName(app)] : [])];

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(t)?.[1]?.toLowerCase();
  if (scheme) {
    if (!SCHEMES.has(scheme)) throw new Error(`I don't open ${scheme}: links.`);
    return [...head, t];
  }
  if (t === "~" || t.startsWith("~/") || isAbsolute(t) || t.startsWith("./") || t.startsWith("../")) {
    const path = t === "~" ? homedir() : t.startsWith("~/") ? resolve(homedir(), t.slice(2)) : resolve(t);
    if (!existsSync(path)) throw new Error(`There is nothing at ${t}.`);
    return [...head, path];
  }
  if (BARE_DOMAIN.test(t)) return [...head, `https://${t}`];
  if (app) throw new Error(`"${t}" is not a web address or a path to open in ${app}.`);
  return [...head, "-a", appName(t)];
}

// ---- the helper-backed hands --------------------------------------------------------------

export interface HelperHandsOptions {
  bin: string;
  /** Jett's own processes, left out of the window list. */
  excludePids?: number[];
}

export function helperHands({ bin, excludePids = [] }: HelperHandsOptions): Hands {
  const exclude = excludePids.flatMap((pid) => ["--exclude-pid", String(pid)]);
  async function call(args: string[], timeoutMs = 8000): Promise<Record<string, any>> {
    const { out, code } = await run([bin, ...args], timeoutMs);
    if (code === 3) throw new AccessibilityOffError();
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(out.trim().split("\n").pop() ?? "");
    } catch {
      throw new Error(`jett-eyes ${args[0]} gave no answer (exit ${code})`);
    }
    if (parsed.error) throw new Error(String(parsed.error));
    return parsed;
  }
  const xy = (p: Pt) => ["--x", String(Math.round(p.x)), "--y", String(Math.round(p.y))];
  return {
    async trusted() {
      return (await call(["ax-ok"], 3000)).ok === true;
    },
    async windows() {
      const r = await call(["windows", ...exclude], 3000);
      return { apps: (r.apps ?? []) as AppInfo[], windows: (r.windows ?? []) as WindowInfo[] };
    },
    async focus(app) {
      const r = await call(["focus", "--app", app], 5000);
      if (r.focused === false) throw new Error(`I could not bring ${r.app ?? app} to the front.`);
      return { app: String(r.app ?? app), pid: Number(r.pid), bundleId: r.bundleId };
    },
    async press(at, pid) {
      const r = await call(["ax-press", ...xy(at), ...(pid ? ["--pid", String(pid)] : []), ...exclude], 5000);
      return { via: r.via === "ax" ? "ax" : "mouse", role: r.role, label: r.label };
    },
    async clickAt(at, options = {}) {
      await call(["click-at", ...xy(at), ...(options.right ? ["--right"] : []), "--count", String(options.count ?? 1)], 5000);
    },
    async type(text) {
      // About 4 ms a character: long text needs a longer wait.
      await call(["type", "--text", text], 5000 + text.length * 10);
    },
    async key(combo) {
      await call(["key", "--combo", combo], 3000);
    },
    async scroll(direction, amount, at) {
      await call(["scroll", "--direction", direction, "--amount", String(amount), ...(at ? xy(at) : [])], 5000);
    },
    async open(argv) {
      if (argv[0] !== "open") throw new Error("not an open command");
      const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "pipe" });
      const timer = setTimeout(() => proc.kill(), 10_000);
      try {
        const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
        if (code !== 0) throw new Error(err.trim().split("\n").pop() || `open failed (exit ${code})`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
