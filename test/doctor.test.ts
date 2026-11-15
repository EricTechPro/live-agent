// Doctor: every probe is injected, so these run with no network, no LiveKit and
// no real CLIs. Each failure must print one plain fix; the exit code is non-zero
// only when something required fails.
import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config/index.ts";
import { formatReport, runDoctor, type DoctorDeps } from "../src/doctor/index.ts";
import { INSTALL_FIX, KEY_FIX } from "../src/helpers/gemini-cli.ts";

const KEY_GUIDE = "README.md#get-your-gemini-key";

function googleSays(status: number, body: unknown = {}): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const MAC_WITH_MIC = {
  SPAudioDataType: [
    {
      _items: [
        { _name: "MacBook Pro Microphone", coreaudio_default_audio_input_device: "spaudio_yes", coreaudio_device_input: 1 },
        { _name: "MacBook Pro Speakers", coreaudio_device_output: 2 },
      ],
    },
  ],
};

/** A machine where everything works. Each test breaks one thing. */
function healthy(over: Partial<DoctorDeps> = {}): Partial<DoctorDeps> {
  return {
    env: { GEMINI_API_KEY: "test-key" },
    fetch: googleSays(200, { name: "models/gemini-3.8-live" }),
    platform: "darwin",
    audioDevices: async () => MAC_WITH_MIC,
    freePort: async () => 40000,
    startLiveKit: async () => ({ stop: async () => {} }),
    geminiCliStatus: () => ({ ok: true, installed: true, bin: "/usr/local/bin/gemini" }),
    which: (bin) => `/usr/local/bin/${bin}`,
    config: defaultConfig(),
    ...over,
  };
}

const find = (r: Awaited<ReturnType<typeof runDoctor>>, name: string) => r.checks.find((c) => c.name === name)!;

describe("doctor", () => {
  test("a working machine passes every check and exits 0", async () => {
    const r = await runDoctor(healthy());
    expect(r.checks.map((c) => [c.name, c.status])).toEqual([
      ["Gemini key", "ok"],
      ["Microphone", "ok"],
      ["LiveKit", "ok"],
      ["Gemini CLI", "ok"],
      ["Codex", "ok"],
      ["Claude Code", "ok"],
    ]);
    expect(r.exitCode).toBe(0);
    expect(find(r, "Microphone").detail).toContain("MacBook Pro Microphone");
  });

  test("a missing key fails with a fix that points to the key guide", async () => {
    const r = await runDoctor(healthy({ env: {} }));
    const key = find(r, "Gemini key");
    expect(key.status).toBe("fail");
    expect(key.fix).toContain(KEY_GUIDE);
    expect(r.exitCode).toBe(1);
  });

  test("an empty key in the live-agent folder fails with a fix that names that folder's .env", async () => {
    const r = await runDoctor(healthy({ env: {}, home: "/Users/me/Desktop/live-agent" }));
    const key = find(r, "Gemini key");
    expect(key.status).toBe("fail");
    expect(key.fix).toContain("/Users/me/Desktop/live-agent/.env");
    expect(key.fix).toContain(KEY_GUIDE);
  });

  test("GOOGLE_API_KEY counts when GEMINI_API_KEY is not set", async () => {
    let sent = "" as string | null;
    const fetch = (async (_url: string, init: RequestInit) => {
      sent = new Headers(init.headers).get("x-goog-api-key");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const r = await runDoctor(healthy({ env: { GOOGLE_API_KEY: "google-key" }, fetch }));
    expect(find(r, "Gemini key").status).toBe("ok");
    expect(sent).toBe("google-key");
  });

  test("a bad key fails with a fix that points to the key guide", async () => {
    const bad = googleSays(400, {
      error: { code: 400, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] },
    });
    const r = await runDoctor(healthy({ fetch: bad }));
    const key = find(r, "Gemini key");
    expect(key.status).toBe("fail");
    expect(key.detail).toContain("not valid");
    expect(key.fix).toContain(KEY_GUIDE);
    expect(r.exitCode).toBe(1);
  });

  test("the key never shows up in the report", async () => {
    const r = await runDoctor(healthy({ env: { GEMINI_API_KEY: "AIzaSECRET123" }, fetch: googleSays(403) }));
    expect(formatReport(r.checks)).not.toContain("AIzaSECRET123");
  });

  test("LiveKit not starting fails with a clear fix", async () => {
    const r = await runDoctor(
      healthy({
        startLiveKit: async () => {
          throw new Error("livekit-server did not start on port 40000 (exited with 1)");
        },
      }),
    );
    const lk = find(r, "LiveKit");
    expect(lk.status).toBe("fail");
    expect(lk.fix).toContain("brew install livekit");
    expect(r.exitCode).toBe(1);
  });

  test("LiveKit not installed says how to install it", async () => {
    const r = await runDoctor(healthy({ which: (bin) => (bin === "livekit-server" ? undefined : `/bin/${bin}`) }));
    const lk = find(r, "LiveKit");
    expect(lk.status).toBe("fail");
    expect(lk.detail).toContain("not found");
    expect(lk.fix).toContain("brew install livekit");
  });

  test("the real runner pointed at a missing binary is reported, not thrown", async () => {
    const r = await runDoctor(healthy({ startLiveKit: undefined, livekitBinary: "/nonexistent/livekit-server" }));
    expect(find(r, "LiveKit").status).toBe("fail");
  });

  test("LiveKit is stopped after a good check", async () => {
    let stopped = false;
    let port = 0;
    await runDoctor(
      healthy({
        startLiveKit: async (o) => {
          port = o.port;
          return { stop: async () => void (stopped = true) };
        },
      }),
    );
    expect(port).toBe(40000);
    expect(stopped).toBe(true);
  });

  test("no microphone fails with a fix", async () => {
    const r = await runDoctor(healthy({ audioDevices: async () => ({ SPAudioDataType: [{ _items: [] }] }) }));
    const mic = find(r, "Microphone");
    expect(mic.status).toBe("fail");
    expect(mic.fix).toContain("System Settings");
    expect(r.exitCode).toBe(1);
  });

  test("a missing helper CLI that is turned off is a warning with an install hint, exit 0", async () => {
    const config = defaultConfig();
    config.helpers.geminiCli = false;
    const r = await runDoctor(
      healthy({ config, geminiCliStatus: () => ({ ok: false, installed: false, fix: INSTALL_FIX }) }),
    );
    const cli = find(r, "Gemini CLI");
    expect(cli.status).toBe("warn");
    expect(cli.fix).toBe(INSTALL_FIX);
    expect(r.exitCode).toBe(0);
  });

  test("a missing helper CLI that is turned on is a failure", async () => {
    const r = await runDoctor(healthy({ geminiCliStatus: () => ({ ok: false, installed: false, fix: INSTALL_FIX }) }));
    expect(find(r, "Gemini CLI").status).toBe("fail");
    expect(r.exitCode).toBe(1);
  });

  test("Gemini CLI installed and a key present is ready (no sign-in needed)", async () => {
    const r = await runDoctor(healthy());
    expect(find(r, "Gemini CLI")).toMatchObject({ status: "ok", detail: "installed, uses your Gemini key" });
  });

  test("Gemini CLI installed but no key gives the key fix", async () => {
    const r = await runDoctor(
      healthy({ geminiCliStatus: () => ({ ok: false, installed: true, bin: "/bin/gemini", fix: KEY_FIX }) }),
    );
    const cli = find(r, "Gemini CLI");
    expect(cli.status).toBe("fail");
    expect(cli.detail).toBe("installed, no Gemini key (turned on)");
    expect(cli.fix).toContain(KEY_GUIDE);
  });

  test("Codex and Claude Code missing are warnings while off, failures when on", async () => {
    const which = (bin: string) => (bin === "codex" || bin === "claude" ? undefined : `/bin/${bin}`);
    const off = await runDoctor(healthy({ which }));
    expect(find(off, "Codex").status).toBe("warn");
    expect(find(off, "Codex").fix).toContain("npm install -g");
    expect(find(off, "Claude Code").status).toBe("warn");
    expect(off.exitCode).toBe(0);

    const config = defaultConfig();
    config.helpers.codex = true;
    const on = await runDoctor(healthy({ which, config }));
    expect(find(on, "Codex").status).toBe("fail");
    expect(on.exitCode).toBe(1);
  });

  test("the report prints one line per check and the fix under each problem", async () => {
    const r = await runDoctor(healthy({ env: {} }));
    const text = formatReport(r.checks);
    expect(text).toContain("✗ Gemini key");
    expect(text).toContain("✓ LiveKit");
    expect(text).toMatch(/Fix: .*README\.md#get-your-gemini-key/);
  });
});
