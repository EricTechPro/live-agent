// `bun run start`: the live-agent core as a process (later the Tauri sidecar).
//
// Starts LiveKit, the agent core with real Gemini Live, and the window's local
// API, then prints ONE JSON line on stdout so the shell knows where to connect:
//
//   {"type":"ready","url":"http://127.0.0.1:53121","launchToken":"..."}
//
// Everything else (logs, rtc-node's debug JSON) goes to stderr.
// `doctor` as the first argument runs the doctor check instead (src/doctor),
// `setup` the typed setup chat (src/setup). With no config file the window
// starts the setup chat itself on first launch (POST /setup { ifNeeded }).
// Stops LiveKit on SIGINT/SIGTERM, on normal exit, and (via the runner's
// watchdog) even if this process is killed hard.
import { startApp, disposeNative } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { geminiLiveModel } from "./models/gemini-live.ts";
import { geminiTidyModel } from "./models/gemini-tidy.ts";
import { tidiesSettled } from "./brain/tidy.ts";
import { existsSync } from "node:fs";
import { TOOLS_DIR } from "./core/registry.ts";
import { bundledTools } from "./core/bundled-tools.ts";
import { doctorMain } from "./doctor/index.ts";
import { setupMain } from "./setup/chat.ts";
import { useHome } from "./home.ts";
import { geminiApiKey } from "./gemini-key.ts";
import { errorMessage } from "./errors.ts";
import pkg from "../package.json" with { type: "json" };

// The installed app sets LIVE_AGENT_HOME (~/Desktop/live-agent): work from there and
// read the key from its .env, because opened from Finder there is no terminal (src/home.ts).
const home = useHome();

// `live-agent doctor` (or `bun run doctor`): check the machine, print fixes, exit.
if (process.argv[2] === "doctor") process.exit(await doctorMain());
// `live-agent-core --version`: the release build's smoke check. It only prints, but every
// import above has loaded by then (incl. rtc-node's native addon), so a broken bundle fails here.
if (process.argv[2] === "--version") {
  console.log(`live-agent ${pkg.version}`);
  process.exit(0);
}
// `live-agent setup` (or `bun run setup`): the setup chat, typed in the terminal (ticket 12).
if (process.argv[2] === "setup") process.exit(await setupMain());

const apiKey = geminiApiKey();
if (!apiKey) {
  console.error(
    home
      ? `live-agent: no Gemini key. Put GEMINI_API_KEY=... in ${home}/.env (or run the installer again).`
      : "live-agent: no Gemini key. Copy .env.example to .env and set GEMINI_API_KEY.",
  );
  process.exit(1);
}

const config = loadConfig();
const app = await startApp({
  config,
  geminiApiKey: apiKey,
  // The Live session connects with a fresh single-use token, never the key itself.
  model: (tokens) => geminiLiveModel({ token: () => tokens.geminiToken() }),
  // After each chat, a background job tidies new raw notes into wiki pages (ticket 07).
  tidy: geminiTidyModel({ apiKey }),
  livekitPort: Number(process.env.LIVE_AGENT_LIVEKIT_PORT ?? 7880),
  port: Number(process.env.LIVE_AGENT_PORT ?? 0),
  // From the repo: read tools/ as usual. As the compiled sidecar there is no tools/ folder, so use the baked-in list.
  tools: existsSync(TOOLS_DIR) ? undefined : bundledTools,
  // Ten quiet minutes end a chat on their own (note + tidy), like pressing New chat.
  chatIdleMs: 10 * 60_000,
}).catch(async (err: unknown) => {
  // startApp already stopped LiveKit; say what broke in one line.
  console.error(`live-agent: could not start: ${errorMessage(err)}`);
  await disposeNative();
  process.exit(1);
});

console.log(JSON.stringify({ type: "ready", url: app.url, launchToken: app.launchToken }));
// For people (stderr, so the shell's stdout stays one JSON line):
console.error(`live-agent: voice check page: ${app.url}/check#${app.launchToken}`);

// The chat-end note takes up to 8 s (summaryTimeoutMs); this leaves LiveKit room inside the shell's 30 s.
const TIDY_ON_QUIT_MS = 15_000;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.stop();
  // Closing the chat queued a tidy job; give it a bounded moment to finish (an
  // unfinished tidy retries next launch). The shell waits 30 s in all
  // (app/src-tauri/src/lib.rs), so chat note + tidy + LiveKit fit inside it.
  await Promise.race([tidiesSettled(), Bun.sleep(TIDY_ON_QUIT_MS)]);
  await disposeNative();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// As the Tauri sidecar: if the app dies without stopping us (crash, force quit),
// we get re-parented to launchd (ppid 1). Stop then, so no core or LiveKit is left behind.
if (process.env.LIVE_AGENT_EXIT_WITH_PARENT) {
  setInterval(() => process.ppid === 1 && shutdown(), 1000).unref();
}
