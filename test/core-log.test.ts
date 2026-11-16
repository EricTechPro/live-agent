// The core log: opened from Finder the core has no terminal, so what it says
// goes to <home>/logs/core.log. It must stay small and never hold a secret.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCoreLog } from "../src/core-log.ts";
import { freeLiveKitPort } from "./free-port.ts";

const MAIN = resolve(import.meta.dir, "..", "src", "main.ts");
const tempHome = () => realpathSync(mkdtempSync(join(tmpdir(), "live-agent-log-")));
const read = (home: string) => readFileSync(join(home, "logs", "core.log"), "utf8");

describe("core log", () => {
  test("writes each message as a line in <home>/logs/core.log", () => {
    const home = tempHome();
    const log = openCoreLog({ home });
    log.write("live-agent: could not start: LiveKit did not start");
    log.write("second line");
    expect(log.path).toBe(join(home, "logs", "core.log"));
    const lines = read(home).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("live-agent: could not start: LiveKit did not start");
    expect(lines[1]).toContain("second line");
    // What the core says can include chat text: only the user may read it.
    expect(statSync(log.path).mode & 0o777).toBe(0o600);
  });

  test("never holds the key or any token", () => {
    const home = tempHome();
    const key = "dummy-gemini-key-0123456789";
    const launch = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718";
    const log = openCoreLog({ home, secrets: [key, undefined] });
    log.hide(launch);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl";
    const googleKey = "AIzaSyD-not-a-real-key-but-looks-like-one";
    const authKey = "AQ.Ab8RN6Kq-not-a-real-auth-key.but_looks_like_one";
    const ephemeral = "auth_tokens/9f8e7d6c5b4a39281706";
    log.write(`starting with key ${key}`);
    log.write(JSON.stringify({ type: "ready", url: "http://127.0.0.1:5000", launchToken: launch }));
    log.write(`live-agent: voice check page: http://127.0.0.1:5000/check#${launch}`);
    log.write(`livekit token ${jwt} and ${googleKey} and ${authKey}`);
    log.write(`gemini session with ${ephemeral}`);
    log.write(`GET /events?token=${launch}`);
    const text = read(home);
    for (const secret of [key, launch, jwt, googleKey, authKey, ephemeral]) expect(text).not.toContain(secret);
    // The rest of each message is still there to read.
    expect(text).toContain("starting with key");
    expect(text).toContain("voice check page");
    expect(text).toContain("gemini session with");
  });

  test("a git commit id is not a secret: it stays readable", () => {
    const home = tempHome();
    const log = openCoreLog({ home, secrets: ["a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718"] });
    const sha = "512d2c5e9f0a1b2c3d4e5f60718293a4b5c6d7e8";
    log.write(`helper job committed ${sha} on live-agent/fix-the-bug`);
    expect(read(home)).toContain(sha);
  });

  test("stays small: past the cap the oldest lines are dropped, the newest kept", () => {
    const home = tempHome();
    const log = openCoreLog({ home, maxBytes: 4000 });
    for (let i = 0; i < 500; i++) log.write(`line number ${i}`);
    expect(statSync(log.path).size).toBeLessThanOrEqual(4000);
    const lines = read(home).trimEnd().split("\n");
    expect(lines.at(-1)).toContain("line number 499");
    expect(read(home)).not.toContain("line number 0\n");
    // Whole lines only: every line still starts with its time.
    for (const line of lines) expect(line).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test("a new launch keeps the log from the last one, within the cap", () => {
    const home = tempHome();
    openCoreLog({ home }).write("from the last launch");
    openCoreLog({ home }).write("from this launch");
    expect(read(home)).toContain("from the last launch");
    expect(read(home)).toContain("from this launch");
  });

  test("the core, started in its home folder like the app does, writes what it says to the log", async () => {
    // An empty key file (the installer's template): the core starts and says it waits
    // for the key in the window (ticket 19).
    const home = tempHome();
    writeFileSync(join(home, ".env"), "GEMINI_API_KEY=\n");
    const core = Bun.spawn([process.execPath, MAIN], {
      cwd: home, // no stray .env here
      env: {
        PATH: process.env.PATH!,
        HOME: process.env.HOME!,
        LIVE_AGENT_HOME: home,
        LIVE_AGENT_LIVEKIT_PORT: String(await freeLiveKitPort()),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      // The ready line on stdout: the window gets a core to talk to.
      const first = await core.stdout.getReader().read();
      expect(new TextDecoder().decode(first.value)).toContain('"type":"ready"');
      expect(read(home)).toContain("no Gemini key yet: waiting for it in the window");
    } finally {
      core.kill("SIGTERM");
      await core.exited;
    }
    expect(await new Response(core.stderr).text()).toContain("no Gemini key yet"); // still on stderr for a terminal
  }, 30_000);
});
