// The LiveKit runner: starts the local `livekit-server` and stops it again.
//
//   const lk = await startLiveKit();          // ws://127.0.0.1:7880, random keys
//   ... lk.url, lk.apiKey, lk.apiSecret ...
//   await lk.stop();
//
// Why local: nobody needs a LiveKit account to talk to live-agent. LiveKit
// Cloud only comes back for phone calls (after the talk).
//
// Why random keys (not dev mode's well-known devkey/secret): anything on the
// machine that knows the secret could mint itself a token and join the room.
// A fresh secret per run lives only in this process.
//
// Why the `sh` watchdog: if the core dies hard (crash, kill -9), exit hooks
// never run and a bare child would be orphaned on its port. The watchdog
// polls our PID and takes the server down with us. (A stdin pipe would be
// neater, but Bun's FileSink.end() did not reliably close the pipe.)
import { livekitBinary } from "../home.ts";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LiveKitServer {
  /** WebSocket URL clients connect to, e.g. ws://127.0.0.1:7880 */
  url: string;
  apiKey: string;
  /** Secret for minting tokens. Stays in the core process; never send it anywhere. */
  apiSecret: string;
  stop(): Promise<void>;
}

export interface LiveKitOptions {
  /** HTTP/WebSocket port. The RTC ports use port+1 (TCP) and port+2 (UDP). Default 7880. */
  port?: number;
  /** Path to the binary. Default: the one bundled next to the core, else `livekit-server` on PATH. */
  binary?: string;
  /** How long to wait for the server to answer. Default 10 s. */
  readyTimeoutMs?: number;
}

const HOST = "127.0.0.1";

export async function startLiveKit(options: LiveKitOptions = {}): Promise<LiveKitServer> {
  const port = options.port ?? 7880;
  const binary = options.binary ?? livekitBinary();
  const apiKey = "live-agent";
  const apiSecret = randomBytes(24).toString("hex");
  const url = `ws://${HOST}:${port}`;

  // Bound to loopback only: the room is for this machine, not the network.
  const config = [
    `port: ${port}`,
    `bind_addresses: ["${HOST}"]`,
    `rtc:`,
    `  tcp_port: ${port + 1}`,
    `  udp_port: ${port + 2}`,
    `  use_external_ip: false`,
    `  node_ip: ${HOST}`,
    `keys:`,
    `  ${apiKey}: ${apiSecret}`,
  ].join("\n");
  const serverArgs = [binary, "--config-body", config];

  // POSIX: a tiny sh watchdog owns the server. It stops the server when it gets
  // SIGTERM (our stop()) or when our own PID disappears (we crashed or were
  // killed -9, so no exit hook ran). `sleep 1 & wait` keeps the trap prompt.
  //
  // Why stop twice: LiveKit's first SIGTERM is a graceful drain that can wait
  // on open keep-alive connections; a second SIGTERM forces it out.
  const stopServer =
    'kill "$pid" 2>/dev/null; n=0; while kill -0 "$pid" 2>/dev/null && [ $n -lt 10 ]; do sleep 0.2; n=$((n+1)); done; ' +
    'kill "$pid" 2>/dev/null; wait "$pid"';
  const watchdog =
    'parent=$1; shift; "$@" & pid=$!; ' +
    `trap '${stopServer}; exit 0' TERM INT; ` +
    'while kill -0 "$parent" 2>/dev/null && kill -0 "$pid" 2>/dev/null; do sleep 1 & wait $!; done; ' +
    stopServer;
  const cmd =
    process.platform === "win32"
      ? serverArgs // TODO(ticket 13): no sh on Windows; rely on stop() and the exit hook.
      : ["sh", "-c", watchdog, "sh", String(process.pid), ...serverArgs];

  // Logs go to a file, not a pipe. Why: an undrained pipe fills up, and once
  // we are gone nobody reads it, so the server blocks writing its "shutting
  // down" line and never exits. A file never blocks.
  const logPath = join(tmpdir(), `live-agent-livekit-${port}.log`);
  const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: Bun.file(logPath) });

  let stopped = false;
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      process.off("exit", onExit);
      proc.kill("SIGTERM");
    }
    await proc.exited;
  };
  // Normal exit: don't wait for the watchdog's next poll.
  const onExit = () => proc.kill("SIGTERM");
  process.on("exit", onExit);

  const deadline = Date.now() + (options.readyTimeoutMs ?? 10_000);
  let exitCode: number | null = null;
  proc.exited.then((code) => (exitCode = code));
  while (Date.now() < deadline) {
    if (exitCode !== null) break;
    try {
      const res = await fetch(`http://${HOST}:${port}`);
      if (res.ok) return { url, apiKey, apiSecret, stop };
    } catch {}
    await Bun.sleep(100);
  }

  await stop();
  const stderr = await Bun.file(logPath).text().catch(() => "");
  throw new Error(
    `livekit-server did not start on port ${port}` +
      (exitCode !== null ? ` (exited with ${exitCode})` : " (timed out)") +
      (stderr ? `: ${stderr.trim().split("\n").slice(-3).join(" | ")}` : "") +
      ` (full log: ${logPath})`,
  );
}
