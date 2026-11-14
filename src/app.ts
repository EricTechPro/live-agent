// The voice app: everything the window needs, started and stopped together.
//
//   const app = await startApp({ model, geminiApiKey });
//   // app.url          http://127.0.0.1:<port>, the window's local API
//   // app.launchToken  per-launch secret the window sends as `Authorization: Bearer ...`
//   await app.stop();  // also stops LiveKit
//
// Start order: LiveKit server -> token service -> agent core session -> the
// core joins the room as "agent" -> local HTTP API for the window.
//
// The window's API (all need the launch token; see notes/08-voice-api.md):
//   GET  /session  -> { livekitUrl, room, identity: "user", token, expiresAt }
//   GET  /events   -> Server-Sent Events, one AgentEvent (JSON) per `data:` line
//                     (EventSource cannot set headers, so `?token=` works here)
//   POST /text     -> { text } in, { events } out: a typed turn
//
// Why HTTP + SSE (not a WebSocket): the window only reads the stream, and
// fetch/EventSource exist in every webview with no library.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dispose } from "@livekit/rtc-node";
import { startSession, type SessionOptions } from "./core/agent.ts";
import type { Model } from "./core/model.ts";
import { joinVoiceRoom } from "./voice/livekit-bridge.ts";
import { startLiveKit, type LiveKitServer } from "./voice/livekit-runner.ts";
import { createTokenService, type TokenService } from "./voice/token-service.ts";

export interface AppOptions extends Omit<SessionOptions, "model"> {
  /** The model, or a function that builds it from the token service (so it can use ephemeral tokens). */
  model: Model | ((tokens: TokenService) => Model);
  /** The real Gemini key. It stays in the token service. */
  geminiApiKey?: string;
  /** Gemini Live model name for ephemeral tokens. */
  geminiModel?: string;
  /** LiveKit's port (RTC uses the next two). Default 7880. */
  livekitPort?: number;
  /** The window API's port. Default 0: any free port (read it from `url`). */
  port?: number;
  room?: string;
}

export interface App {
  url: string;
  launchToken: string;
  /** The running LiveKit server (holds the secret: keep it in this process). */
  livekit: LiveKitServer;
  stop(): Promise<void>;
}

const CORS = {
  "Access-Control-Allow-Origin": "*", // auth is the bearer token, not cookies
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export async function startApp(options: AppOptions): Promise<App> {
  const { model, geminiApiKey, geminiModel, livekitPort, port, room: roomName, ...sessionOptions } = options;
  const room = roomName ?? "live-agent";
  const livekit = await startLiveKit({ port: livekitPort });
  const cleanups: (() => Promise<unknown> | unknown)[] = [() => livekit.stop()];
  const stop = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  };

  try {
    const tokens = createTokenService({
      livekit,
      room,
      gemini: geminiApiKey ? { apiKey: geminiApiKey, model: geminiModel } : undefined,
    });
    const session = await startSession({
      ...sessionOptions,
      model: typeof model === "function" ? model(tokens) : model,
    });
    cleanups.push(() => session.close());

    const bridge = await joinVoiceRoom({ session, url: livekit.url, token: (await tokens.livekitToken("agent")).token });
    cleanups.push(() => bridge.close());

    const launchToken = randomBytes(24).toString("hex");
    const allowed = (given: string | null) =>
      !!given && given.length === launchToken.length && timingSafeEqual(Buffer.from(given), Buffer.from(launchToken));

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: port ?? 0,
      idleTimeout: 255, // seconds; the event stream also pings well inside this
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
        // The manual voice check page holds no secrets; it reads the launch token from its URL hash.
        // TODO(ticket 13): embed it in the compiled sidecar (it is read from disk here).
        if (req.method === "GET" && url.pathname === "/check") {
          return new Response(Bun.file(new URL("./voice/check-page.html", import.meta.url)), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
        const given = bearer ?? (url.pathname === "/events" ? url.searchParams.get("token") : null);
        if (!allowed(given)) return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

        if (req.method === "GET" && url.pathname === "/session") {
          const { token, expiresAt } = await tokens.livekitToken("user");
          return Response.json({ livekitUrl: livekit.url, room, identity: "user", token, expiresAt }, { headers: CORS });
        }
        if (req.method === "POST" && url.pathname === "/text") {
          const { text } = (await req.json()) as { text?: unknown };
          if (typeof text !== "string" || !text.trim()) {
            return Response.json({ error: "send { text }" }, { status: 400, headers: CORS });
          }
          try {
            return Response.json({ events: await session.sendText(text) }, { headers: CORS });
          } catch (err) {
            return Response.json({ error: String((err as Error).message ?? err) }, { status: 409, headers: CORS });
          }
        }
        if (req.method === "GET" && url.pathname === "/events") {
          let off = () => {};
          let ping: ReturnType<typeof setInterval> | undefined;
          const body = new ReadableStream<string>({
            start(controller) {
              controller.enqueue(": connected\n\n");
              off = session.onEvent((event) => controller.enqueue(`data: ${JSON.stringify(event)}\n\n`));
              ping = setInterval(() => controller.enqueue(": ping\n\n"), 30_000);
            },
            cancel() {
              off();
              clearInterval(ping);
            },
          });
          return new Response(body, {
            headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          });
        }
        return Response.json({ error: "not found" }, { status: 404, headers: CORS });
      },
    });
    cleanups.push(() => server.stop(true));

    return { url: `http://127.0.0.1:${server.port}`, launchToken, livekit, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

/** Free rtc-node's native side. Call once, right before the process exits. */
export const disposeNative = dispose;
