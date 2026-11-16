// The core log: a small file in the live-agent folder holding what the core says.
//
//   const log = openCoreLog({ home, secrets: [apiKey] });
//   captureConsole(log);            // console.* also lands in <home>/logs/core.log
//   log.hide(launchToken);          // a secret learned later
//
// Why: opened from Finder the core has no terminal, so its messages went
// nowhere and a problem ("it makes a weird sound") could not be looked into.
// The window's "Show log" link reveals this file.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

export interface CoreLog {
  /** `<home>/logs/core.log` */
  path: string;
  write(text: string): void;
  /** Never write this value (e.g. a token made after the log was opened). */
  hide(secret: string | undefined): void;
}

/** About 30 minutes of a chatty session; old lines are dropped past this. */
const MAX_BYTES = 256 * 1024;

// Token shapes, hidden even when nobody told the log about them. No rule for
// plain hex: git commit ids are hex too. The launch token is hidden exactly (log.hide).
const TOKEN_SHAPES: RegExp[] = [
  /eyJ[\w-]{6,}\.[\w-]+\.[\w-]+/g, // JWTs (LiveKit room tokens)
  /AIza[\w-]{20,}/g, // Google API keys (standard)
  /\bAQ\.[\w.-]{20,}/g, // Google auth keys (AI Studio, since May 2026)
  /auth_tokens\/[\w-]+/g, // Gemini ephemeral tokens
  /((?:token|key|secret|authorization)["']?\s*[:=]\s*["']?(?:Bearer\s+)?)[^\s"'&,}]{8,}/gi, // token=..., "key":"..."
];

/** `text` with every given secret and every token-looking value replaced by [hidden]. */
export function redact(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[hidden]");
  for (const shape of TOKEN_SHAPES) {
    out = out.replace(shape, (_m, prefix) => (typeof prefix === "string" ? `${prefix}[hidden]` : "[hidden]"));
  }
  return out;
}

export function openCoreLog(o: { home: string; maxBytes?: number; secrets?: (string | undefined)[] }): CoreLog {
  // Short values would blank out ordinary words; real keys and tokens are long.
  const secrets = new Set<string>();
  const hide = (s: string | undefined) => void (s && s.length >= 8 && secrets.add(s));
  for (const s of o.secrets ?? []) hide(s);

  const dir = join(o.home, "logs");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "core.log");
  const max = o.maxBytes ?? MAX_BYTES;
  let size = existsSync(path) ? statSync(path).size : 0;
  return {
    path,
    hide,
    write(raw) {
      const text = redact(raw, secrets);
      const stamp = new Date().toISOString();
      const lines = text.replace(/\n+$/, "").split("\n").map((line) => `${stamp} ${line}\n`).join("");
      appendFileSync(path, lines, { mode: 0o600 });
      size += Buffer.byteLength(lines);
      if (size > max) {
        // Keep the newest half, cut at a line start, so trimming is rare and lines stay whole.
        const buf = readFileSync(path);
        let from = Math.max(0, buf.length - Math.floor(max / 2));
        from = buf.indexOf(10, from) + 1;
        const kept = from > 0 ? buf.subarray(from) : Buffer.alloc(0);
        writeFileSync(path, kept);
        size = kept.length;
      }
    },
  };
}

/**
 * Copy everything the core prints (console.* and direct stdout/stderr writes)
 * into the log too; the terminal still gets it. Bun's console does not go
 * through process.stderr.write, so both are wrapped. Native addons that write
 * straight to fd 2 (rtc-node's debug JSON) are not captured.
 */
export function captureConsole(log: CoreLog): void {
  const safeWrite = (text: string) => {
    try {
      log.write(text);
    } catch {
      // A full disk or a removed folder must never stop the core.
    }
  };
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      safeWrite(format(...args));
    };
  }
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      safeWrite(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
      return original(chunk, ...rest);
    }) as typeof stream.write;
  }
}
