// The one-line installer (get.sh), run the way a user runs it, against a fake
// release tarball (file://) in a throwaway HOME. Checks what a user would see:
// the app in Applications, the Desktop folder with the sample brain and key file,
// doctor run, and that a second run (an upgrade) keeps the user's brain and config.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GET_SH = resolve(import.meta.dir, "..", "get.sh");

/** A fake release: live-agent.app with a core that records how doctor was run, and a sample brain. */
function fakeRelease(dir: string, version: string): string {
  const app = join(dir, `build-${version}`, "live-agent.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents", "Resources", "sample-brain", "wiki"), { recursive: true });
  writeFileSync(join(app, "Contents", "Resources", "sample-brain", "wiki", "tomato-garden.md"), "# Tomatoes\n");
  writeFileSync(join(app, "Contents", "VERSION"), version);
  const core = join(app, "Contents", "MacOS", "live-agent-core");
  writeFileSync(
    core,
    `#!/bin/sh\necho "doctor-ran $* home=$LIVE_AGENT_HOME cwd=$(pwd -P)" >> "$LIVE_AGENT_HOME/doctor.log"\necho "fake doctor: all checks pass"\nexit \${FAKE_DOCTOR_EXIT:-0}\n`,
  );
  chmodSync(core, 0o755);
  const tarball = join(dir, `live-agent-${version}.tar.gz`);
  Bun.spawnSync(["tar", "-czf", tarball, "-C", join(dir, `build-${version}`), "live-agent.app"]);
  return tarball;
}

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-get-")));
  const home = join(root, "home");
  mkdirSync(join(home, "Desktop"), { recursive: true });
  return { root, home, apps: join(home, "Applications"), folder: join(home, "Desktop", "live-agent") };
}

function runGet(s: ReturnType<typeof sandbox>, tarball: string, extra: Record<string, string> = {}, args: string[] = [], cwd?: string) {
  const r = Bun.spawnSync(["bash", GET_SH, "--no-open", ...args], {
    cwd,
    env: {
      PATH: process.env.PATH!,
      HOME: s.home,
      LIVE_AGENT_TARBALL: `file://${tarball}`,
      LIVE_AGENT_APPS: s.apps,
      LIVE_AGENT_TTY: "/dev/null", // no terminal: never prompt for the key
      ...extra,
    },
    stdin: "ignore",
  });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

describe("get.sh", () => {
  test("a fresh install puts the app in Applications and makes the Desktop folder with the sample brain", () => {
    const s = sandbox();
    const r = runGet(s, fakeRelease(s.root, "1"));
    expect(r.code).toBe(0);
    expect(readFileSync(join(s.apps, "live-agent.app", "Contents", "VERSION"), "utf8")).toBe("1");
    expect(readFileSync(join(s.folder, "sample-brain", "wiki", "tomato-garden.md"), "utf8")).toBe("# Tomatoes\n");
    // No config yet: the setup chat writes it on first launch.
    expect(existsSync(join(s.folder, "live-agent.config.json"))).toBe(false);
    // Doctor ran from the installed app, pointed at the Desktop folder.
    expect(readFileSync(join(s.folder, "doctor.log"), "utf8")).toContain(`doctor-ran doctor home=${s.folder}`);
    expect(r.out).toContain("fake doctor: all checks pass");
  });

  test("with no terminal it writes an empty key file, private to the user, and the app asks for the key", () => {
    const s = sandbox();
    const r = runGet(s, fakeRelease(s.root, "1"));
    const env = join(s.folder, ".env");
    expect(readFileSync(env, "utf8")).toBe("GEMINI_API_KEY=\n");
    expect(statSync(env).mode & 0o777).toBe(0o600);
    // Not a warning: the app opens on "Paste your Gemini key" (ticket 19).
    expect(r.out).toContain("the app will ask for your Gemini key");
    expect(r.out).not.toContain("no key yet");
  });

  test("with no terminal it still ends by opening the app, which shows the key screen", () => {
    const s = sandbox();
    // A fake `open` first on PATH records what get.sh opens.
    const bin = join(s.root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "open"), `#!/bin/sh\necho "$@" > "${join(s.root, "opened")}"\n`);
    chmodSync(join(bin, "open"), 0o755);
    const tarball = fakeRelease(s.root, "1");
    const r = Bun.spawnSync(["bash", GET_SH], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: s.home,
        LIVE_AGENT_TARBALL: `file://${tarball}`,
        LIVE_AGENT_APPS: s.apps,
        LIVE_AGENT_TTY: "/dev/null",
      },
      stdin: "ignore",
    });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(s.root, "opened"), "utf8").trim()).toBe(join(s.apps, "live-agent.app"));
    expect(readFileSync(join(s.folder, ".env"), "utf8")).toBe("GEMINI_API_KEY=\n");
  });

  test("asks for the Gemini key on the terminal and saves it with 600 permissions, without printing it", () => {
    const s = sandbox();
    const answer = join(s.root, "tty");
    writeFileSync(answer, "dummy-key-for-test\n");
    const r = runGet(s, fakeRelease(s.root, "1"), { LIVE_AGENT_TTY: answer });
    expect(r.code).toBe(0);
    const env = join(s.folder, ".env");
    expect(readFileSync(env, "utf8")).toBe("GEMINI_API_KEY=dummy-key-for-test\n");
    expect(statSync(env).mode & 0o777).toBe(0o600);
    expect(r.out).not.toContain("dummy-key-for-test");
  });

  test("running it again upgrades the app and leaves the brain, config and key alone", () => {
    const s = sandbox();
    expect(runGet(s, fakeRelease(s.root, "1")).code).toBe(0);
    // The user uses it: a note, a config from the setup chat, a key.
    writeFileSync(join(s.folder, "sample-brain", "wiki", "tomato-garden.md"), "# My tomatoes\n");
    mkdirSync(join(s.folder, "sample-brain", "raw"), { recursive: true });
    writeFileSync(join(s.folder, "sample-brain", "raw", "mine.md"), "my note\n");
    writeFileSync(join(s.folder, "live-agent.config.json"), '{"brainPath":"sample-brain"}\n');
    writeFileSync(join(s.folder, ".env"), "GEMINI_API_KEY=kept-key\n");

    const answer = join(s.root, "tty");
    writeFileSync(answer, "should-not-be-asked\n");
    const r = runGet(s, fakeRelease(s.root, "2"), { LIVE_AGENT_TTY: answer });
    expect(r.code).toBe(0);
    expect(readFileSync(join(s.apps, "live-agent.app", "Contents", "VERSION"), "utf8")).toBe("2");
    expect(readFileSync(join(s.folder, "sample-brain", "wiki", "tomato-garden.md"), "utf8")).toBe("# My tomatoes\n");
    expect(readFileSync(join(s.folder, "sample-brain", "raw", "mine.md"), "utf8")).toBe("my note\n");
    expect(readFileSync(join(s.folder, "live-agent.config.json"), "utf8")).toBe('{"brainPath":"sample-brain"}\n');
    expect(readFileSync(join(s.folder, ".env"), "utf8")).toBe("GEMINI_API_KEY=kept-key\n");
  });

  test("doctor runs from the live-agent folder, so a .env where get.sh was run is never read", () => {
    // Bun loads .env from the working folder. Run from a repo with its own key,
    // doctor must still check the live-agent folder's key (ticket 20).
    const s = sandbox();
    const elsewhere = join(s.root, "some-repo");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, ".env"), "GEMINI_API_KEY=stray-repo-key\n");
    const r = runGet(s, fakeRelease(s.root, "1"), {}, [], elsewhere);
    expect(r.code).toBe(0);
    expect(readFileSync(join(s.folder, "doctor.log"), "utf8")).toContain(`cwd=${s.folder}`);
  });

  test("a failing doctor only warns: the setup chat helps fix it", () => {
    const s = sandbox();
    const r = runGet(s, fakeRelease(s.root, "1"), { FAKE_DOCTOR_EXIT: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("doctor found problems");
  });

  test("a bad download fails clearly and installs nothing", () => {
    const s = sandbox();
    const r = runGet(s, join(s.root, "missing.tar.gz"));
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("download failed");
    expect(existsSync(join(s.apps, "live-agent.app"))).toBe(false);
  });

  test("a checksum file that does not match stops the install", () => {
    const s = sandbox();
    const tarball = fakeRelease(s.root, "1");
    writeFileSync(`${tarball}.sha256`, `${"0".repeat(64)}  live-agent-darwin-arm64.tar.gz\n`);
    const r = runGet(s, tarball);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("checksum");
    expect(existsSync(join(s.apps, "live-agent.app"))).toBe(false);
  });

  test("--help prints the usage", () => {
    const r = Bun.spawnSync(["bash", GET_SH, "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("curl -fsSL https://raw.githubusercontent.com/EricTechPro/live-agent/main/get.sh | bash");
  });
});
