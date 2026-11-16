// Jett's eyes: the core's side of the jett-eyes helper (app/src-tauri/eyes/main.swift).
//
// Capture on demand, never a stream: the model calls `look` when it needs to see, and a
// circle drawn while holding Ctrl+Option sends one crop. Each command runs the helper
// once and reads its one JSON line. Tests pass a fake `Eyes` instead.
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Pt, Rect, ShotMap } from "./geometry.ts";

export interface FrontWindow {
  app: string;
  bundleId?: string;
  pid: number;
  /** Missing without Screen Recording. */
  title?: string;
  /** The page address, for browsers we can ask (AppleScript). */
  url?: string;
  bounds?: Rect;
  /** macOS's window number: a different window means a different id. */
  windowId?: number;
}

/** What `watch` reports while Jett's marks are up (global points). */
export type WatchEvent =
  | { type: "front"; front: FrontWindow | null }
  | { type: "scroll"; at: Pt }
  | { type: "click"; at: Pt };

/** A real control or words found through Accessibility (global points). */
export interface AxHit {
  label?: string;
  role: string;
  frame: Rect;
  /** The words equal the query (not just contain it). */
  exact?: boolean;
}

/** One line of on-device OCR (global points); `match` is the box of just the query's words. */
export interface OcrLine {
  text: string;
  frame: Rect;
  confidence?: number;
  match?: Rect;
}

export interface ScreenState {
  /** The main display in global points. */
  display: Rect;
  front: FrontWindow | null;
}

export interface Shot {
  jpeg: Uint8Array;
  map: ShotMap;
}

export interface ShotOptions {
  /** Global points; default the whole main display. */
  rect?: Rect;
  /** Long side in pixels. Default 1568. */
  maxPx?: number;
  /** Loops of global points to draw on the shot in teal. */
  ink?: Pt[][];
}

export interface Eyes {
  /** Is Screen Recording on for Jett? */
  permission(): Promise<boolean>;
  /** Ask macOS (its prompt shows once) and open the right Settings pane. */
  requestPermission(): Promise<boolean>;
  state(): Promise<ScreenState>;
  /** Throws ScreenPermissionError when Screen Recording is off. */
  shot(options?: ShotOptions): Promise<Shot>;
  /**
   * Follow the screen while marks are up: front window changes, scrolls, clicks.
   * Returns a stop function. Missing: nothing is followed (marks stay until erased).
   */
  watch?(on: (event: WatchEvent) => void): () => void;
  /** Accessibility (slice 3): finding real controls by their words. Missing: no AX tier. */
  ax?: {
    trusted(): Promise<boolean>;
    /** Ask macOS (its prompt shows once) and open the right Settings pane. */
    request(): Promise<boolean>;
    /** Controls in the front window whose words equal or contain `text`. */
    find(text: string): Promise<{ trusted: boolean; matches: AxHit[]; window?: Rect }>;
    /** Every control in the front window (for snapping a guessed box), plus static text frames. */
    controls(): Promise<{ trusted: boolean; controls: AxHit[]; texts: Rect[]; window?: Rect }>;
  };
  /** On-device OCR (Vision) of an area, default the front window. Missing: no OCR tier. */
  ocr?(options: { rect?: Rect; text?: string; accurate?: boolean }): Promise<{ lines: OcrLine[]; area: Rect }>;
}

export class ScreenPermissionError extends Error {
  constructor() {
    super(
      "Screen Recording is off for Jett, so I can't see the screen. Turn it on in System Settings > " +
        "Privacy & Security > Screen Recording, then restart Jett.",
    );
    this.name = "ScreenPermissionError";
  }
}

export const SCREEN_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
export const AX_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

/**
 * Where the helper is: $LIVE_AGENT_EYES, next to the compiled core (inside Jett.app,
 * Tauri puts externalBins side by side), or the repo's build output (bun run start).
 */
export function findEyesBin(): string | undefined {
  const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
  const candidates = [
    process.env.LIVE_AGENT_EYES,
    join(dirname(process.execPath), "jett-eyes"),
    resolve(import.meta.dir, `../../app/src-tauri/binaries/jett-eyes-${triple}`),
  ];
  return candidates.find((p): p is string => !!p && existsSync(p));
}

/** Browsers whose front tab address AppleScript can read (asked with a short timeout). */
const URL_SCRIPTS: Record<string, string> = {
  "com.apple.Safari": 'tell application id "com.apple.Safari" to get URL of front document',
  "com.google.Chrome": 'tell application id "com.google.Chrome" to get URL of active tab of front window',
  "com.brave.Browser": 'tell application id "com.brave.Browser" to get URL of active tab of front window',
  "com.microsoft.edgemac": 'tell application id "com.microsoft.edgemac" to get URL of active tab of front window',
  "company.thebrowser.Browser": 'tell application id "company.thebrowser.Browser" to get URL of active tab of front window',
};

async function run(cmd: string[], timeoutMs: number): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const out = await new Response(proc.stdout).text();
    return { out, code: await proc.exited };
  } finally {
    clearTimeout(timer);
  }
}

async function browserUrl(bundleId: string | undefined): Promise<string | undefined> {
  const script = bundleId && URL_SCRIPTS[bundleId];
  if (!script) return undefined;
  const { out, code } = await run(["osascript", "-e", script], 700).catch(() => ({ out: "", code: 1 }));
  const url = out.trim();
  return code === 0 && /^[a-z]+:\/\//i.test(url) ? url : undefined;
}

export interface HelperEyesOptions {
  bin: string;
  /** Jett's own processes, left out of every shot (the app's pid). */
  excludePids?: number[];
}

/** Eyes backed by the jett-eyes helper. */
export function helperEyes({ bin, excludePids = [] }: HelperEyesOptions): Eyes {
  const exclude = excludePids.flatMap((pid) => ["--exclude-pid", String(pid)]);
  async function call(args: string[], timeoutMs = 8000): Promise<Record<string, any>> {
    const { out, code } = await run([bin, ...args], timeoutMs);
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(out.trim().split("\n").pop() ?? "");
    } catch {
      throw new Error(`jett-eyes ${args[0]} gave no answer (exit ${code})`);
    }
    if (code === 2) throw new ScreenPermissionError();
    if (parsed.error) throw new Error(String(parsed.error));
    return parsed;
  }
  return {
    async permission() {
      return (await call(["screen-ok"])).ok === true;
    },
    async requestPermission() {
      const ok = (await call(["request"])).ok === true;
      if (!ok) await run(["open", SCREEN_SETTINGS_URL], 3000).catch(() => {});
      return ok;
    },
    async state() {
      const s = await call(["state", ...exclude], 3000);
      const front = s.front as FrontWindow | null;
      if (front) front.url = await browserUrl(front.bundleId);
      return { display: s.display as Rect, front };
    },
    async shot(options = {}) {
      const args = ["shot", ...exclude, "--max", String(options.maxPx ?? 1568)];
      const r = options.rect;
      if (r) args.push("--rect", [r.x, r.y, r.w, r.h].join(","));
      if (options.ink?.length) args.push("--ink", JSON.stringify(options.ink.map((loop) => loop.map((p) => [p.x, p.y]))));
      const s = await call(args);
      return {
        jpeg: Uint8Array.from(Buffer.from(String(s.jpeg), "base64")),
        map: { origin: s.origin, size: s.size, px: { w: s.width, h: s.height } },
      };
    },
    watch(on) {
      // One long-running helper; it exits when its stdin closes (kill, or the core going away).
      const proc = Bun.spawn([bin, "watch", ...exclude], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
      const lines = createInterface({ input: Readable.fromWeb(proc.stdout as any) });
      lines.on("line", (line) => {
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if ("front" in msg) on({ type: "front", front: (msg.front as FrontWindow | null) ?? null });
        else if (msg.scroll) on({ type: "scroll", at: msg.scroll as Pt });
        else if (msg.click) on({ type: "click", at: msg.click as Pt });
      });
      return () => {
        lines.close();
        proc.kill();
      };
    },
    ax: {
      async trusted() {
        return (await call(["ax-ok"], 3000)).ok === true;
      },
      async request() {
        const ok = (await call(["ax-request"], 3000)).ok === true;
        if (!ok) await run(["open", AX_SETTINGS_URL], 3000).catch(() => {});
        return ok;
      },
      async find(text) {
        const r = await call(["ax-find", ...exclude, "--text", text], 5000);
        return { trusted: r.trusted !== false, matches: (r.matches ?? []) as AxHit[], window: r.window as Rect | undefined };
      },
      async controls() {
        const r = await call(["ax-controls", ...exclude], 5000);
        return {
          trusted: r.trusted !== false,
          controls: (r.controls ?? []) as AxHit[],
          texts: ((r.texts ?? []) as { frame: Rect }[]).map((t) => t.frame),
          window: r.window as Rect | undefined,
        };
      },
    },
    async ocr({ rect, text, accurate }) {
      const args = ["ocr", ...exclude];
      if (rect) args.push("--rect", [rect.x, rect.y, rect.w, rect.h].join(","));
      if (text) args.push("--text", text);
      if (accurate) args.push("--accurate");
      // The accurate model loads once per boot (~20 s the first time, then ~0.3 s).
      const r = await call(args, accurate ? 30_000 : 8000);
      return { lines: (r.lines ?? []) as OcrLine[], area: r.area as Rect };
    },
  };
}
