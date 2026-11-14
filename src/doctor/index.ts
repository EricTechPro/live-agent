// Doctor: checks everything a new user needs and prints one plain fix per problem.
//
//   bun run doctor            (dev)
//   live-agent doctor         (the compiled core binary)
//
// Checks: Gemini key works, a microphone is there, local LiveKit starts, and
// which helper CLIs are installed (Gemini CLI also needs the Gemini key, which
// it runs on; Codex and Claude Code sign-in is not checked). Exit code is 1 only when
// something required fails. A helper CLI is only required when it is turned on.
//
// Every probe is injectable (`DoctorDeps`), so tests run with no network,
// no LiveKit and no real CLIs.
import { geminiApiKey } from "../gemini-key.ts";
import { livekitBinary } from "../home.ts";
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { ConfigError, defaultConfig, loadConfig, type Config } from "../config/index.ts";
import { geminiCliStatus, type GeminiCliStatus } from "../helpers/gemini-cli.ts";
import { startLiveKit } from "../voice/livekit-runner.ts";

export type CheckStatus = "ok" | "warn" | "fail";
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** One plain fix, only when something is wrong. */
  fix?: string;
}

export interface DoctorDeps {
  env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string };
  fetch: typeof fetch;
  platform: NodeJS.Platform;
  /** `system_profiler SPAudioDataType -json` output (macOS). */
  audioDevices: () => Promise<unknown>;
  /** A port P where P (TCP), P+1 (TCP) and P+2 (UDP) are free. */
  freePort: () => Promise<number>;
  /** Starts LiveKit; the doctor stops it right away. Default: the real runner. */
  startLiveKit: (o: { port: number; binary: string }) => Promise<{ stop(): Promise<void> }>;
  /** LiveKit binary. Default: `livekit-server` found on PATH. */
  livekitBinary?: string;
  geminiCliStatus: () => GeminiCliStatus;
  which: (bin: string) => string | undefined;
  config: Config;
  model: string;
}

export const KEY_GUIDE = "README.md#get-your-gemini-key";
const MODEL = "gemini-3.8-live";
const LIVEKIT_INSTALL = "Reinstall live-agent, or for development: brew install livekit";

const ok = (name: string, detail: string): CheckResult => ({ name, status: "ok", detail });
const warn = (name: string, detail: string, fix?: string): CheckResult => ({ name, status: "warn", detail, fix });
const fail = (name: string, detail: string, fix?: string): CheckResult => ({ name, status: "fail", detail, fix });

export async function runDoctor(deps: Partial<DoctorDeps> = {}): Promise<{ checks: CheckResult[]; exitCode: number }> {
  // Undefined fields fall back to the real probe.
  const given = Object.fromEntries(Object.entries(deps).filter(([, v]) => v !== undefined));
  const d: DoctorDeps = { ...defaultDeps(), ...given };
  const checks = [
    await checkGeminiKey(d),
    await checkMic(d),
    await checkLiveKit(d),
    ...checkHelpers(d),
  ];
  return { checks, exitCode: checks.some((c) => c.status === "fail") ? 1 : 0 };
}

async function checkGeminiKey(d: DoctorDeps): Promise<CheckResult> {
  const name = "Gemini key";
  const key = geminiApiKey(d.env);
  if (!key) return fail(name, "No Gemini key found.", `Put GEMINI_API_KEY in your .env file. How to get one: ${KEY_GUIDE}`);
  // A model lookup costs no tokens. The key goes in a header so it never lands in a URL or log.
  const res = await d
    .fetch(`https://generativelanguage.googleapis.com/v1beta/models/${d.model}`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(8000),
    })
    .catch(() => null);
  if (!res) return fail(name, "Could not reach Google.", "Check your internet connection and run doctor again.");
  if (res.ok) return ok(name, `key works, ${d.model} is available`);
  const body: any = await res.json().catch(() => ({}));
  const reason = body?.error?.details?.find((x: any) => x?.reason)?.reason;
  if (res.status === 400 && reason === "API_KEY_INVALID")
    return fail(name, "Gemini key is not valid.", `Make a new key and put it in .env. How: ${KEY_GUIDE}`);
  if (res.status === 403)
    return fail(name, "This key may not use the Gemini API.", `Make the key in Google AI Studio. How: ${KEY_GUIDE}`);
  if (res.status === 404)
    return fail(name, `Model ${d.model} is not available for this key.`, `Check your key's project. How: ${KEY_GUIDE}`);
  if (res.status === 429) return warn(name, "Key works but is over its quota right now.", "Wait a minute, or check your quota in AI Studio.");
  return fail(name, `Google answered ${res.status}.`, `Check your key. How: ${KEY_GUIDE}`);
}

async function checkMic(d: DoctorDeps): Promise<CheckResult> {
  const name = "Microphone";
  if (d.platform !== "darwin") return warn(name, "Not checked on this system yet.");
  let data: any;
  try {
    data = await d.audioDevices();
  } catch {
    return warn(name, "Could not list sound devices.", "Check System Settings > Sound > Input.");
  }
  const items: any[] = (data?.SPAudioDataType ?? []).flatMap((x: any) => x?._items ?? []);
  const inputs = items.filter((i) => i?.coreaudio_device_input);
  if (inputs.length === 0)
    return fail(name, "No microphone found.", "Plug in a mic or headset, or pick one in System Settings > Sound > Input.");
  const def = inputs.find((i) => i.coreaudio_default_audio_input_device === "spaudio_yes") ?? inputs[0];
  // Permission belongs to the app window, so the app asks for it on first use.
  return ok(name, `default input: ${def._name}`);
}

async function checkLiveKit(d: DoctorDeps): Promise<CheckResult> {
  const name = "LiveKit";
  const binary = d.livekitBinary ?? d.which("livekit-server");
  if (!binary) return fail(name, "livekit-server not found.", LIVEKIT_INSTALL);
  let port = 0;
  try {
    port = await d.freePort();
    const server = await d.startLiveKit({ port, binary });
    await server.stop();
    return ok(name, `local server starts (port ${port})`);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return fail(name, `LiveKit did not start: ${why}`, `Run "${binary} --dev" in a terminal to see why. If it is missing: ${LIVEKIT_INSTALL}`);
  }
}

function checkHelpers(d: DoctorDeps): CheckResult[] {
  const h = d.config.helpers;
  const missingOrBad = (name: string, on: boolean, detail: string, fix: string) =>
    on ? fail(name, `${detail} (turned on)`, fix) : warn(name, `${detail} (turned off)`, fix);

  const g = d.geminiCliStatus();
  const gemini = g.ok
    ? ok("Gemini CLI", `installed, uses your Gemini key${h.geminiCli ? "" : " (turned off)"}`)
    : missingOrBad("Gemini CLI", h.geminiCli, g.installed ? "installed, no Gemini key" : "not installed", g.fix);

  // v1 only checks that Codex and Claude Code are installed (sign-in is not checked).
  const other = (name: string, bin: string, on: boolean, install: string) =>
    d.which(bin)
      ? ok(name, `installed${on ? "" : " (turned off)"}`)
      : missingOrBad(name, on, "not installed", `Install it with: ${install}`);

  return [
    gemini,
    other("Codex", "codex", h.codex, "npm install -g @openai/codex"),
    other("Claude Code", "claude", h.claudeCode, "npm install -g @anthropic-ai/claude-code"),
  ];
}

const ICON: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

export function formatReport(checks: CheckResult[]): string {
  const lines = ["live-agent doctor", ""];
  for (const c of checks) {
    lines.push(`${ICON[c.status]} ${c.name}: ${c.detail}`);
    if (c.fix && c.status !== "ok") lines.push(`    Fix: ${c.fix}`);
  }
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  lines.push("", fails ? `${fails} problem(s) to fix${warns ? `, ${warns} warning(s)` : ""}.` : warns ? `All required checks pass, ${warns} warning(s).` : "All checks pass.");
  return lines.join("\n");
}

/** `live-agent doctor`: run, print, return the exit code. */
export async function doctorMain(): Promise<number> {
  let config: Config;
  let configError: CheckResult | undefined;
  try {
    config = loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    config = defaultConfig();
    configError = fail("Config", err.message, "Fix that field in live-agent.config.json, or delete the file to use the defaults.");
  }
  const { checks, exitCode } = await runDoctor({ config });
  const all = configError ? [configError, ...checks] : checks;
  console.log(formatReport(all));
  return configError ? 1 : exitCode;
}

function defaultDeps(): DoctorDeps {
  return {
    env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_API_KEY: process.env.GOOGLE_API_KEY },
    fetch: globalThis.fetch,
    platform: process.platform,
    audioDevices: () => Bun.$`system_profiler SPAudioDataType -json`.quiet().json(),
    freePort: findFreePort,
    startLiveKit: (o) => startLiveKit({ port: o.port, binary: o.binary, readyTimeoutMs: 5000 }),
    // The helper runs on the same key the voice uses (installed + key = ready).
    geminiCliStatus: () => geminiCliStatus(),
    which: (bin) => Bun.which(bin) ?? undefined,
    // Inside the installed app: the livekit-server bundled next to the core.
    livekitBinary: livekitBinary() === "livekit-server" ? undefined : livekitBinary(),
    config: defaultConfig(),
    model: MODEL,
  };
}

/** Never assume LiveKit's default ports are free: find P with P, P+1 (TCP) and P+2 (UDP) all free. */
async function findFreePort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const p = await tcpFree(0);
    if (p > 0 && p + 2 < 65536 && (await tcpFree(p + 1)) && (await udpFree(p + 2))) return p;
  }
  throw new Error("no free port found");
}

function tcpFree(port: number): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(0));
    s.listen(port, "127.0.0.1", () => {
      const got = (s.address() as { port: number }).port;
      s.close(() => resolve(got));
    });
  });
}

function udpFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createSocket("udp4");
    s.once("error", () => resolve(false));
    s.bind(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
