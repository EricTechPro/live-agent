// `bun run start`: the live-agent core as a process (later the Tauri sidecar).
//
// Starts LiveKit, the agent core with real Gemini Live, and the window's local
// API, then prints ONE JSON line on stdout so the shell knows where to connect:
//
//   {"type":"ready","url":"http://127.0.0.1:53121","launchToken":"..."}
//
// Everything else (logs, rtc-node's debug JSON) goes to stderr.
// `doctor` as the first argument runs the doctor check instead (src/doctor).
// Stops LiveKit on SIGINT/SIGTERM, on normal exit, and (via the runner's
// watchdog) even if this process is killed hard.
import { startApp, disposeNative } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { geminiLiveModel } from "./models/gemini-live.ts";
import { doctorMain } from "./doctor/index.ts";

// `live-agent doctor` (or `bun run doctor`): check the machine, print fixes, exit.
if (process.argv[2] === "doctor") process.exit(await doctorMain());

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("live-agent: no Gemini key. Copy .env.example to .env and set GEMINI_API_KEY.");
  process.exit(1);
}

const config = loadConfig();
const app = await startApp({
  config,
  geminiApiKey: apiKey,
  // The Live session connects with a fresh single-use token, never the key itself.
  model: (tokens) => geminiLiveModel({ token: () => tokens.geminiToken() }),
  livekitPort: Number(process.env.LIVE_AGENT_LIVEKIT_PORT ?? 7880),
  port: Number(process.env.LIVE_AGENT_PORT ?? 0),
}).catch(async (err: unknown) => {
  // startApp already stopped LiveKit; say what broke in one line.
  console.error(`live-agent: could not start: ${err instanceof Error ? err.message : String(err)}`);
  await disposeNative();
  process.exit(1);
});

console.log(JSON.stringify({ type: "ready", url: app.url, launchToken: app.launchToken }));
// For people (stderr, so the shell's stdout stays one JSON line):
console.error(`live-agent: voice check page: ${app.url}/check#${app.launchToken}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.stop();
  await disposeNative();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
