// The live-agent home: the folder the installed app works from.
//
//   useHome();                     // first thing in main.ts
//   startLiveKit({ binary: livekitBinary() });
//
// Why: opened from Finder, the core gets no terminal. No useful working folder,
// no key in the environment, a bare PATH (/usr/bin:/bin:...). The Tauri shell
// sets LIVE_AGENT_HOME (default ~/Desktop/live-agent, made by get.sh), and this
// module turns that into everything the core needs:
//   - it works from the home folder, so `live-agent.config.json` and a relative
//     brain path (the default `sample-brain`) resolve there;
//   - it reads the Gemini key from `<home>/.env` (written by get.sh, mode 600).
//     The key stays in the core process: the window only ever gets tokens;
//   - it adds the usual tool folders to PATH so helper CLIs (gemini) are found.
// Without LIVE_AGENT_HOME (running from the repo) nothing changes.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Env = Record<string, string | undefined>;

// Where Homebrew and npm usually put CLIs. A Finder-launched app's PATH has none of them.
const TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** Switch the core to its home folder. Returns the home, or undefined when none is set. */
export function useHome(env: Env = process.env): string | undefined {
  const home = env.LIVE_AGENT_HOME;
  if (!home) return undefined;
  mkdirSync(home, { recursive: true });
  process.chdir(home);

  const dotenv = join(home, ".env");
  if (existsSync(dotenv)) {
    for (const [key, value] of parseDotenv(readFileSync(dotenv, "utf8"))) {
      // A key already in the environment wins; an empty line (the installer's template) sets nothing.
      if (value && !env[key]) env[key] = value;
    }
  }

  const path = (env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of TOOL_DIRS) if (!path.includes(dir)) path.push(dir);
  if (env.HOME) for (const dir of [".bun/bin", ".npm-global/bin", ".local/bin"]) path.push(join(env.HOME, dir));
  env.PATH = path.join(":");
  return home;
}

// KEY=value lines; `#` comments and blank lines skipped; one pair of quotes stripped.
function parseDotenv(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out.push([m[1]!, m[2]!.replace(/^(['"])(.*)\1$/, "$2")]);
  }
  return out;
}

/**
 * The livekit-server to run: the one bundled next to the core binary (inside
 * live-agent.app/Contents/MacOS), else `livekit-server` on PATH (dev, brew).
 */
export function livekitBinary(execPath: string = process.execPath): string {
  const bundled = join(dirname(execPath), "livekit-server");
  return existsSync(bundled) ? bundled : "livekit-server";
}

/**
 * Save the key pasted in the window (ticket 19) as `GEMINI_API_KEY=` in
 * `<dir>/.env`, readable only by you (600), and put it in `env` so the running
 * core uses it now. Other lines stay. Written to a temp file, then renamed, so a
 * crash never leaves a half-written .env. The caller checked the key's shape
 * (one word, no newline), so it cannot add a line.
 */
export function saveGeminiKey(dir: string, key: string, env: Env = process.env): void {
  const dotenv = join(dir, ".env");
  const lines = existsSync(dotenv) ? readFileSync(dotenv, "utf8").replace(/\n$/, "").split("\n") : [];
  const at = lines.findIndex((line) => /^\s*(?:export\s+)?GEMINI_API_KEY\s*=/.test(line));
  if (at >= 0) lines[at] = `GEMINI_API_KEY=${key}`;
  else lines.push(`GEMINI_API_KEY=${key}`);
  const temp = `${dotenv}.${process.pid}.tmp`;
  writeFileSync(temp, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600); // the umask may have masked the mode
  renameSync(temp, dotenv);
  env.GEMINI_API_KEY = key;
}
