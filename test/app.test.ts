// The whole voice app as the window sees it: start it, ask for a session over
// local HTTP, follow the event stream, stop it. Real LiveKit, scripted model.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type App } from "../src/app.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { defineTool } from "../src/core/tool.ts";
import { freeLiveKitPort } from "./free-port.ts";

// Free ports, so a running app or another test run never collides with these.
const LIVEKIT_PORT = await freeLiveKitPort();
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

  test("only the app's own window (and localhost pages) may read the API from a browser", async () => {
    const from = (origin: string) =>
      fetch(`${app.url}/session`, { headers: { ...auth(), Origin: origin } }).then((res) => res.headers.get("access-control-allow-origin"));

    expect(await from("tauri://localhost")).toBe("tauri://localhost");
    expect(await from("http://localhost:1420")).toBe("http://localhost:1420");
    expect(await from("https://evil.example")).toBeNull();
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
    const otherPort = await freeLiveKitPort();
    const other = await startApp({ model: scriptedModel([]), livekitPort: otherPort, tools: [] });
    await other.stop();
    const up = await fetch(`http://127.0.0.1:${otherPort}`).then(() => true, () => false);
    expect(up).toBe(false);
  }, 15_000);
});

// Ticket 10: the window's job board and mode switch talk to these endpoints.
describe("window commands: cancel a job, switch the mode", () => {
  // A tool that starts a job which runs until it is cancelled.
  const startWait = defineTool({
    name: "start_wait",
    description: "start a job that waits",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: (_args, { jobs }) => ({
      jobId: jobs!.submit({
        kind: "test",
        title: "wait for cancel",
        run: ({ signal }) => new Promise((_ok, fail) => signal.addEventListener("abort", () => fail(new Error("stopped")))),
      }),
    }),
  });
  let cmd: App;
  beforeAll(async () => {
    cmd = await startApp({
      model: scriptedModel([
        [{ type: "tool.call", id: "c1", name: "start_wait", args: {} }],
        [{ type: "text", text: "Started." }],
        [{ type: "text", text: "It was cancelled." }],
      ]),
      livekitPort: await freeLiveKitPort(),
      tools: [startWait],
      mode: "auto-edits",
    });
  });
  afterAll(() => cmd.stop());
  const post = (path: string, body?: unknown, token = cmd.launchToken) =>
    fetch(`${cmd.url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const events = () => {
    const seen: { type: string; [k: string]: unknown }[] = [];
    const ready = fetch(`${cmd.url}/events?token=${cmd.launchToken}`).then(async (res) => {
      const reader = res.body!.getReader();
      (async () => {
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += new TextDecoder().decode(value);
          const parts = buf.split("\n\n");
          buf = parts.pop()!;
          for (const p of parts) if (p.startsWith("data: ")) seen.push(JSON.parse(p.slice(6)));
        }
      })();
      return reader;
    });
    return { seen, ready };
  };
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(20);
    expect(check()).toBe(true);
  };

  test("GET /mode says the current mode; POST /mode switches it and announces it", async () => {
    const stream = events();
    const reader = await stream.ready;
    const now = await fetch(`${cmd.url}/mode`, { headers: { Authorization: `Bearer ${cmd.launchToken}` } });
    expect(await now.json()).toEqual({
      mode: "auto-edits",
      // The window draws its dropdown from this list, so the labels live with the core's modes.
      modes: [
        { id: "ask-me", label: "Ask me" },
        { id: "auto-edits", label: "Auto edits" },
        { id: "bypass", label: "Bypass" },
      ],
    });

    expect(await (await post("/mode", { mode: "bypass" })).json()).toEqual({ mode: "bypass" });
    expect(await (await post("/mode", { cycle: true })).json()).toEqual({ mode: "ask-me" });
    await until(() => stream.seen.filter((e) => e.type === "mode.changed").length === 2);
    expect(stream.seen.filter((e) => e.type === "mode.changed")).toEqual([
      { type: "mode.changed", mode: "bypass" },
      { type: "mode.changed", mode: "ask-me" },
    ]);
    expect((await post("/mode", { mode: "yolo" })).status).toBe(400);
    await post("/mode", { mode: "auto-edits" });
    await reader.cancel();
  });

  test("POST /jobs/:id/cancel cancels that job; an unknown id is a 404", async () => {
    const stream = events();
    const reader = await stream.ready;
    await post("/text", { text: "start the wait job" });
    await until(() => stream.seen.some((e) => e.type === "job.state" && e.state === "running"));

    expect((await post("/jobs/job-99/cancel")).status).toBe(404);
    const res = await post("/jobs/job-1/cancel");
    expect(await res.json()).toEqual({ cancelled: true });
    await until(() => stream.seen.some((e) => e.type === "job.state" && e.state === "cancelled"));
    await reader.cancel();
  });

  test("POST /chat/new ends this chat (note saved) and starts the next", async () => {
    const stream = events();
    const reader = await stream.ready;

    const res = await post("/chat/new");

    expect(res.status).toBe(200);
    await until(() => stream.seen.some((e) => e.type === "chat.started"));
    expect(stream.seen).toContainEqual(expect.objectContaining({ type: "brain.write", cause: "chat-end" }));
    await reader.cancel();
  });

  test("both commands need the per-launch token", async () => {
    expect((await post("/chat/new", undefined, "guess")).status).toBe(401);
    expect((await post("/mode", { mode: "bypass" }, "guess")).status).toBe(401);
    expect((await post("/jobs/job-1/cancel", undefined, "guess")).status).toBe(401);
    expect((await fetch(`${cmd.url}/mode`)).status).toBe(401);
  });
});
