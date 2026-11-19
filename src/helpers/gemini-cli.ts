// Helper adapter: run Gemini CLI headless as a background job.
//
//   jobs.submit(geminiCliJob({ task: "fix the failing test", cwd: "/path/to/project" }));
//
// What it runs:
//   gemini -p "<task>" --output-format stream-json --approval-mode yolo --skip-trust
// - yolo: headless Gemini CLI denies any tool call that needs approval, so
//   without it the helper could not edit anything. Our own safety gate already
//   asked the user before a helper starts (helper risk).
// - --skip-trust: an untrusted folder would make headless mode exit at once.
// - Auth: the same Gemini API key as the voice (Google ended Gemini CLI's free
//   "Login with Google" tier for this kind of client). It goes in as
//   GEMINI_API_KEY only: with GOOGLE_API_KEY set too, the CLI prints a warning.
// - A private CLI home owned by live-agent (GEMINI_CLI_HOME, default under the
//   OS app-data folder) whose `.gemini/settings.json` selects API-key auth, so
//   the user's own `gemini` login and settings are never read or touched.
//   HOME itself is left alone, so git and the project behave as usual.
// - Spawned in its own process group, so cancel stops the CLI and everything it
//   started (shell commands, MCP servers): see src/helpers/cli-job.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobSpec } from "../core/jobs.ts";
import { capSummary, childEnv, findBin, shortTitle, jsonLine, liveAgentDataDir, runCli, type HelperPaths } from "./cli-job.ts";
import { geminiApiKey } from "../gemini-key.ts";
import { geminiMcpServers, type McpServers } from "./mcp.ts";

const KEY_GUIDE = "README.md#get-your-gemini-key";
export const INSTALL_FIX = "Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli";
export const KEY_FIX = `The helper needs a Gemini key. Paste it in the live-agent window, or put it after GEMINI_API_KEY= in the .env file in your live-agent folder. How to get one: ${KEY_GUIDE}`;
export const KEY_REJECTED_FIX = `Gemini CLI rejected the Gemini key. Check GEMINI_API_KEY in the .env file in your live-agent folder, then restart live-agent. How to get one: ${KEY_GUIDE}`;

/** The Gemini CLI binary looked up on PATH unless told otherwise. */
export const DEFAULT_GEMINI_BIN = "gemini";

export interface GeminiCliOptions extends HelperPaths {
  /** What the helper should do, in plain words. */
  task: string;
  /** The project folder the helper works in. */
  cwd: string;
}

/** live-agent's own folder for the helper's Gemini CLI home (in the OS app-data folder). */
export function defaultHelperHome(): string {
  return join(liveAgentDataDir(), "gemini-cli");
}

/**
 * Make sure the private home's settings select API-key auth and carry the config's
 * app connections (`mcpServers`, ${VAR} left for Gemini CLI to fill in). Any other
 * settings in it are kept.
 */
function prepareHome(home: string, mcpServers: McpServers = {}) {
  const dir = join(home, ".gemini");
  const file = join(dir, "settings.json");
  let settings: any = {};
  try {
    settings = JSON.parse(readFileSync(file, "utf8")) ?? {};
  } catch {}
  const before = JSON.stringify(settings);
  settings.security = { ...settings.security, auth: { ...settings.security?.auth, selectedType: "gemini-api-key" } };
  const servers = geminiMcpServers(mcpServers);
  if (Object.keys(servers).length) settings.mcpServers = servers;
  else delete settings.mcpServers;
  if (JSON.stringify(settings) === before) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Find the binary, or undefined if it is not there. */
export function findGeminiCli(bin = DEFAULT_GEMINI_BIN): string | undefined {
  return findBin(bin);
}

export type GeminiCliStatus =
  | { ok: true; installed: true; bin: string }
  | { ok: false; installed: true; bin: string; fix: string }
  | { ok: false; installed: false; fix: string };

/**
 * Installed and a key present? Cheap: no network, no model call (the doctor uses it too).
 * Whether Google accepts the key shows at run time as exit code 41.
 */
export function geminiCliStatus({ bin = DEFAULT_GEMINI_BIN, apiKey = geminiApiKey() }: { bin?: string; apiKey?: string } = {}): GeminiCliStatus {
  const path = findGeminiCli(bin);
  if (!path) return { ok: false, installed: false, fix: INSTALL_FIX };
  return apiKey ? { ok: true, installed: true, bin: path } : { ok: false, installed: true, bin: path, fix: KEY_FIX };
}

export function geminiCliJob({
  task,
  cwd,
  geminiCliBin: bin = DEFAULT_GEMINI_BIN,
  geminiCliHome: home = defaultHelperHome(),
  geminiApiKey: apiKey = geminiApiKey(),
  cancelGraceMs = 3000,
  mcpServers,
}: GeminiCliOptions): JobSpec {
  return {
    kind: "gemini-cli",
    title: shortTitle(task),
    async run({ signal, setTokens }) {
      const status = geminiCliStatus({ bin, apiKey });
      if (!status.ok) throw new Error(status.fix);
      prepareHome(home, mcpServers);

      let said = "";
      let error: string | undefined;
      const { GEMINI_CLI_HOME: _h, ...env } = childEnv();
      const r = await runCli({
        argv: [status.bin, "-p", task, "--output-format", "stream-json", "--approval-mode", "yolo", "--skip-trust"],
        cwd,
        env: { ...env, GEMINI_API_KEY: apiKey, GEMINI_CLI_HOME: home, GEMINI_CLI_TRUST_WORKSPACE: "true" },
        signal,
        cancelGraceMs,
        // stream-json: one event per line.
        onLine(line) {
          const ev = jsonLine(line);
          if (ev?.type === "message" && ev.role === "assistant" && typeof ev.content === "string") said += ev.content;
          if (ev?.type === "result" && ev.status === "error") error = ev.error?.message ?? "Gemini CLI reported an error";
          if (ev?.type === "result" && typeof ev.stats?.total_tokens === "number") setTokens?.(ev.stats.total_tokens);
        },
      });
      if (r === "cancelled") return "cancelled";
      if (r.code === 41) throw new Error(KEY_REJECTED_FIX);
      if (r.code === 52) throw new Error(`Gemini CLI settings are broken: check ${join(home, ".gemini", "settings.json")}`);
      if (r.code !== 0 || error) {
        throw new Error(error ?? `Gemini CLI stopped with exit code ${r.code}${r.stderrTail ? `: ${r.stderrTail}` : ""}`);
      }
      return capSummary(said, "Gemini CLI finished without a reply.");
    },
  };
}
