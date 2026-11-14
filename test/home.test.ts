// The live-agent home: the Desktop folder the installed app works from.
// Opened from Finder the core has no terminal: no cwd, no key in the
// environment, no livekit-server on PATH. useHome() gives it all three.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { livekitBinary, useHome } from "../src/home.ts";

const startDir = process.cwd();
afterEach(() => process.chdir(startDir));

function tempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "live-agent-home-")));
}

describe("useHome", () => {
  test("with no LIVE_AGENT_HOME nothing changes (running from the repo)", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
    expect(useHome(env)).toBeUndefined();
    expect(process.cwd()).toBe(startDir);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  test("works from the home folder, so the config and a relative brain path resolve there", () => {
    const home = tempDir();
    expect(useHome({ LIVE_AGENT_HOME: home })).toBe(home);
    expect(process.cwd()).toBe(home);
  });

  test("creates the home folder if it is missing", () => {
    const home = join(tempDir(), "live-agent");
    useHome({ LIVE_AGENT_HOME: home });
    expect(statSync(home).isDirectory()).toBe(true);
  });

  test("reads the Gemini key from the home .env", () => {
    const home = tempDir();
    writeFileSync(join(home, ".env"), "# my key\nGEMINI_API_KEY=dummy-key-123\n\nOTHER = 'quoted value'\n");
    const env: Record<string, string | undefined> = { LIVE_AGENT_HOME: home };
    useHome(env);
    expect(env.GEMINI_API_KEY).toBe("dummy-key-123");
    expect(env.OTHER).toBe("quoted value");
  });

  test("a key already in the environment wins over the .env file", () => {
    const home = tempDir();
    writeFileSync(join(home, ".env"), "GEMINI_API_KEY=from-file\n");
    const env: Record<string, string | undefined> = { LIVE_AGENT_HOME: home, GEMINI_API_KEY: "from-env" };
    useHome(env);
    expect(env.GEMINI_API_KEY).toBe("from-env");
  });

  test("an empty key line in .env (installer template) leaves the key unset", () => {
    const home = tempDir();
    writeFileSync(join(home, ".env"), "GEMINI_API_KEY=\n");
    const env: Record<string, string | undefined> = { LIVE_AGENT_HOME: home };
    useHome(env);
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  test("adds the usual tool folders to a Finder-style PATH so helper CLIs are found", () => {
    const home = tempDir();
    const env: Record<string, string | undefined> = { LIVE_AGENT_HOME: home, PATH: "/usr/bin:/bin" };
    useHome(env);
    const parts = env.PATH!.split(":");
    expect(parts.slice(0, 2)).toEqual(["/usr/bin", "/bin"]);
    expect(parts).toContain("/opt/homebrew/bin");
    expect(parts).toContain("/usr/local/bin");
  });
});

describe("livekitBinary", () => {
  test("prefers the livekit-server bundled next to the core (inside the .app)", () => {
    const dir = tempDir();
    const bundled = join(dir, "livekit-server");
    writeFileSync(bundled, "#!/bin/sh\n");
    chmodSync(bundled, 0o755);
    expect(livekitBinary(join(dir, "live-agent-core"))).toBe(bundled);
  });

  test("falls back to livekit-server on PATH (dev: brew install livekit)", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "empty"));
    expect(livekitBinary(join(dir, "empty", "bun"))).toBe("livekit-server");
  });
});
