// `bun run start`: the live-agent core as a process (later the Tauri sidecar).
//
// Starts LiveKit, the agent core with real Gemini Live, and the window's local
// API, then prints ONE JSON line on stdout so the shell knows where to connect:
//
//   {"type":"ready","url":"http://127.0.0.1:53121","launchToken":"..."}
//
// Everything else (logs, rtc-node's debug JSON) goes to stderr.
// `doctor` as the first argument runs the doctor check instead (src/doctor).
// Setup is the window's click-through wizard: it shows on first launch (no
// config file, or no key) and from the Setup button (GET/POST /setup/*).
// Stops LiveKit on SIGINT/SIGTERM, on normal exit, and (via the runner's
// watchdog) even if this process is killed hard.
import { startApp, disposeNative } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { geminiLiveModel, isNetworkError, networkRetryDelay } from "./models/gemini-live.ts";
import { geminiTidyModel } from "./models/gemini-tidy.ts";
import { tidiesSettled } from "./brain/tidy.ts";
import { existsSync } from "node:fs";
import { TOOLS_DIR } from "./core/registry.ts";
import { bundledTools } from "./core/bundled-tools.ts";
import { doctorMain } from "./doctor/index.ts";
import { saveGeminiKey, useHome } from "./home.ts";
import { captureConsole, openCoreLog } from "./core-log.ts";
import { geminiApiKey, verifyGeminiKey } from "./gemini-key.ts";
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
// `live-agent setup` was the typed setup chat; setup is the app window's wizard now.
if (process.argv[2] === "setup") {
  console.error("live-agent: setup lives in the app window now. Open live-agent and press Setup.");
  process.exit(1);
}

// No key yet (first launch, installer run without a terminal): the core still
// starts, and the window asks for the key (ticket 19, docs/adr/0002).
const apiKey = geminiApiKey();
// The installed app: opened from Finder nobody sees stderr, so keep a small log in
// <home>/logs/core.log too (the window's "Show log" reveals it). Never the key or a token.
const coreLog = home ? openCoreLog({ home, secrets: [apiKey] }) : undefined;
if (coreLog) captureConsole(coreLog);
if (!apiKey) console.error("live-agent: no Gemini key yet: waiting for it in the window.");

const config = loadConfig();
// Ticket 40: a network failure while starting (the Mac just woke, Wi-Fi not back yet)
// must not end the core. The model adapter already retries on its own; this is the
// net under it: try the whole start again with backoff instead of exiting.
const startOnce = () => startApp({
  config,
  geminiApiKey: apiKey,
  // The key pasted in the window: checked with Google, saved to <home>/.env (600), never logged.
  keyGate: {
    check: (key) => {
      coreLog?.hide(key); // from here on the log never shows it, whatever goes wrong
      return verifyGeminiKey(key);
    },
    save: (key) => saveGeminiKey(home ?? process.cwd(), key),
  },
  // The Live session connects with a fresh single-use token, never the key itself.
  model: (tokens) => geminiLiveModel({ token: () => tokens.geminiToken() }),
  // After each chat, a background job tidies new raw notes into wiki pages (ticket 07).
  // It reads the key when it runs, so a key pasted in the window works too.
  tidy: (args) => geminiTidyModel({ apiKey: geminiApiKey() ?? "" })(args),
  livekitPort: Number(process.env.LIVE_AGENT_LIVEKIT_PORT ?? 7880),
  port: Number(process.env.LIVE_AGENT_PORT ?? 0),
  // From the repo: read tools/ as usual. As the compiled sidecar there is no tools/ folder, so use the baked-in list.
  tools: existsSync(TOOLS_DIR) ? undefined : bundledTools,
  // Ten quiet minutes end a chat on their own (note + tidy), like pressing New chat.
  chatIdleMs: 10 * 60_000,
});
async function startWithRetry() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await startOnce();
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      const wait = networkRetryDelay(attempt);
      console.error(`live-agent: no network while starting (${errorMessage(err)}): retrying in ${wait / 1000}s`);
      await Bun.sleep(wait);
    }
  }
}
const app = await startWithRetry().catch(async (err: unknown) => {
  // startApp already stopped LiveKit; say what broke in one line.
  console.error(`live-agent: could not start: ${errorMessage(err)}`);
  await disposeNative();
  process.exit(1);
});

coreLog?.hide(app.launchToken);
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
