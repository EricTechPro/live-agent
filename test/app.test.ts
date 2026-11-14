// The whole voice app as the window sees it: start it, ask for a session over
// local HTTP, follow the event stream, stop it. Real LiveKit, scripted model.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type App } from "../src/app.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const LIVEKIT_PORT = 7920;
const GEMINI_KEY = "AIza-real-key-must-never-reach-the-window";

let app: App;
beforeAll(async () => {
  app = await startApp({
    model: scriptedModel([[{ type: "text", text: "Hi from the core." }]]),
    geminiApiKey: GEMINI_KEY,
    livekitPort: LIVEKIT_PORT,
    tools: [],
  });
});
afterAll(() => app.stop());

const auth = () => ({ Authorization: `Bearer ${app.launchToken}` });

describe("voice app, as the window sees it", () => {
  test("starting the app starts the local LiveKit server", async () => {
    const res = await fetch(`http://127.0.0.1:${LIVEKIT_PORT}`);
    expect(res.ok).toBe(true);
  });

  test("the window only ever receives a short-lived room token, never a real key", async () => {
    const res = await fetch(`${app.url}/session`, { headers: auth() });
    const text = await res.text();
    const body = JSON.parse(text);

    expect(Object.keys(body).sort()).toEqual(["expiresAt", "identity", "livekitUrl", "room", "token"]);
    expect(body.identity).toBe("user");
    expect(body.livekitUrl).toBe(`ws://127.0.0.1:${LIVEKIT_PORT}`);
    const claims = JSON.parse(Buffer.from(body.token.split(".")[1], "base64url").toString());
    expect(claims.exp - Date.now() / 1000).toBeLessThanOrEqual(10 * 60);
    // Neither the Gemini key nor the LiveKit secret, anywhere in what it got.
    expect(text).not.toContain(GEMINI_KEY);
    expect(text).not.toContain(app.livekit.apiSecret);
  });

  test("the manual voice check page loads without the token and carries no secrets", async () => {
    const res = await fetch(`${app.url}/check`);
    const html = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("/session");
    expect(html).not.toContain(app.launchToken);
    expect(html).not.toContain(GEMINI_KEY);
  });

  test("without the per-launch token, the window gets nothing", async () => {
    expect((await fetch(`${app.url}/session`)).status).toBe(401);
    expect((await fetch(`${app.url}/session`, { headers: { Authorization: "Bearer guess" } })).status).toBe(401);
  });

  test("the window sees agent events live on /events, and can send a text turn", async () => {
    const stream = await fetch(`${app.url}/events?token=${app.launchToken}`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();

    const res = await fetch(`${app.url}/text`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello core" }),
    });
    expect(((await res.json()) as { events: unknown[] }).events.at(-1)).toEqual({ type: "turn.done", reply: "Hi from the core." });

    let raw = "";
    while (!raw.includes("turn.done")) raw += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    const events = raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    expect(events).toEqual([
      { type: "transcript", role: "user", text: "hello core" },
      { type: "transcript", role: "model", text: "Hi from the core." },
      { type: "turn.done", reply: "Hi from the core." },
    ]);
  });
});

describe("stopping the app", () => {
  test("stops the local LiveKit server too", async () => {
    const other = await startApp({ model: scriptedModel([]), livekitPort: LIVEKIT_PORT + 10, tools: [] });
    await other.stop();
    const up = await fetch(`http://127.0.0.1:${LIVEKIT_PORT + 10}`).then(() => true, () => false);
    expect(up).toBe(false);
  }, 15_000);
});
