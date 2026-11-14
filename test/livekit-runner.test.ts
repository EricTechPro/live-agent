// The LiveKit runner, tested for real: it starts the local `livekit-server`
// binary and stops it again. Needs `livekit-server` on PATH (brew install livekit).
import { describe, expect, test } from "bun:test";
import { startLiveKit } from "../src/voice/livekit-runner.ts";

const PORT = 7960;

async function isUp(url: string) {
  try {
    const res = await fetch(url.replace(/^ws/, "http"));
    return res.ok;
  } catch {
    return false;
  }
}

describe("LiveKit runner", () => {
  test("starts a local server that answers, and stop() takes it down", async () => {
    const server = await startLiveKit({ port: PORT });

    expect(server.url).toBe(`ws://127.0.0.1:${PORT}`);
    expect(await isUp(server.url)).toBe(true);

    await server.stop();
    expect(await isUp(server.url)).toBe(false);
  });

  test("each run gets its own random API secret, not the well-known dev one", async () => {
    const server = await startLiveKit({ port: PORT });
    try {
      expect(server.apiSecret).not.toBe("secret");
      expect(server.apiSecret.length).toBeGreaterThanOrEqual(32);
    } finally {
      await server.stop();
    }
  });

  test("the server goes away when the process that started it exits", async () => {
    // A separate Bun process starts LiveKit and then simply exits.
    const child = Bun.spawn(
      ["bun", "-e", `
        const { startLiveKit } = await import(${JSON.stringify(import.meta.dir + "/../src/voice/livekit-runner.ts")});
        await startLiveKit({ port: ${PORT} });
        console.log("up");
        process.exit(0);
      `],
      { stdout: "pipe" },
    );
    expect((await new Response(child.stdout).text()).trim()).toBe("up");
    await child.exited;

    // Give the OS a moment to reap the server.
    let up = true;
    for (let i = 0; i < 40 && up; i++) {
      up = await isUp(`ws://127.0.0.1:${PORT}`);
      if (up) await Bun.sleep(100);
    }
    expect(up).toBe(false);
  });
});
