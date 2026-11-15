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
// With no Gemini key (and a `keyGate`), only LiveKit and the API start; the
// chat starts once the window posts a key that works (ticket 19).
//
// The window's API (all need the launch token; see notes/08-voice-api.md):
//   GET  /key      -> { needed }: true until there is a Gemini key
//   POST /key      -> { key } in, { ok } out, or 400 { error } for a bad key: checks it,
//                     saves it to .env, starts the chat. Until then the routes below answer 503.
//   GET  /session  -> { livekitUrl, room, identity: "user", token, expiresAt }
//   GET  /events   -> Server-Sent Events, one AgentEvent (JSON) per `data:` line
//                     (EventSource cannot set headers, so `?token=` works here)
//   POST /text     -> { text } in, { events } out: a typed turn
//   GET  /mode     -> { mode, modes: [{ id, label }] }: the safety mode now, and the choices
//   POST /mode     -> { mode } or { cycle: true } in, { mode } out; emits `mode.changed`
//   POST /jobs/:id/cancel -> { cancelled } (404 for an unknown id)
//   The setup wizard (these work before a key too, so the wizard can run first):
//   GET  /setup    -> { needed, keyNeeded, configPath, current }: no config file yet? no key yet?
//                     `current` is the config now (defaults on a first launch), to prefill the wizard
//   POST /setup/pick-folder -> { within? } in, { path, relative? } or { cancelled: true } out: the
//                     native macOS folder picker. With `within` (the notes folder) it opens there and
//                     answers the pick relative to it, or 400 when the pick is outside it
//   POST /setup/scan -> { path } in, { tree, parts } out: the folder's top-level folders and file
//                     counts (names only, never contents) and the brain parts they map to
//   POST /setup/save -> the wizard's answers in (src/setup SetupAnswers), { config } out, or
//                     400 { error }: writes the config, creates missing part folders, and the
//                     running chat uses it at once (reconnecting for the new voice and tone)
//   POST /chat/new -> { ok }: end this chat (note + tidy job) and start the next
//   POST /pause    -> { paused } in and out: Jett stops speaking and hearing, the chat stays
//   POST /reply/stop -> { ok }: Esc in the window, stop the reply being spoken (an `interrupted`)
//   GET  /brain/tree -> the brain's three parts as a file tree (markdown only, junk folders skipped)
//   GET  /brain/file?path=wiki/x.md -> { path, text }: one note, read only. 400 for anything
//                     outside the three part folders (.., absolute, a symlink out), 404 when gone
//   GET  /brain/chats -> { chats: [{ path, title, date }] }: past chats (chat-end notes in raw), newest first
//
// Why HTTP + SSE (not a WebSocket): the window only reads the stream, and
// fetch/EventSource exist in every webview with no library.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dispose } from "@livekit/rtc-node";
import { startSession, type AgentSession, type SessionOptions } from "./core/agent.ts";
import type { Model } from "./core/model.ts";
import { MODE_LABELS, MODES, type SafetyMode } from "./core/safety.ts";
import { errorMessage } from "./errors.ts";
import { ConfigError, defaultConfigPath } from "./config/index.ts";
import { brainRoot } from "./brain/index.ts";
import { BrainFileMissing, BrainPathError, brainTree, readBrainFile } from "./brain/tree.ts";
import { pastChats } from "./brain/chats.ts";
import { currentConfig, saveSetup, type SetupAnswers } from "./setup/index.ts";
import { detectParts, pickFolder as macPickFolder, scanFolder, type FolderPicker } from "./setup/folders.ts";
import { insideBrain } from "./setup/parts.ts";
import { joinVoiceRoom } from "./voice/livekit-bridge.ts";
// `type: "text"` embeds the file in the compiled binary; bun-types calls *.html an HTMLBundle.
import checkPage from "./voice/check-page.html" with { type: "text" };
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
  /**
   * With no `geminiApiKey`: start in "needs key" state. LiveKit and the API run;
   * the chat waits for the window to post a key that `check` accepts and `save`
   * has stored. Without a gate the chat starts with no key (tests, scripted model).
   */
  keyGate?: KeyGate;
  /** The wizard's folder picker. Default: the native macOS one (osascript); tests pass a fake. */
  pickFolder?: FolderPicker;
}

export interface KeyGate {
  /** Undefined when the key works, else one plain sentence for the window. */
  check(key: string): Promise<string | undefined>;
  save(key: string): void | Promise<void>;
}

export interface App {
  url: string;
  launchToken: string;
  /** The running LiveKit server (holds the secret: keep it in this process). */
  livekit: LiveKitServer;
  stop(): Promise<void>;
}

// Which web pages may read the API from a browser: the app's own window
// (tauri://localhost on macOS, http(s)://tauri.localhost elsewhere) and pages
// on this machine (the Vite dev server, the /check page). Why bother, when
// every call needs the launch token anyway: a page from the internet should
// not even get to try.
const ALLOWED_ORIGIN = /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED_ORIGIN.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
// A command the core refused right now (e.g. a turn is already in progress).
const refused = (err: unknown) => json({ error: errorMessage(err) }, 409);
const readBody = async (req: Request): Promise<Record<string, unknown>> =>
  ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

// What a pasted Gemini key may look like: one word of letters, digits, -, _ and .
// Covers older standard keys ("AIza...") and the auth keys AI Studio makes since
// May 2026 ("AQ...."). Only a cheap shape check: the live call in keyGate.check
// decides. Checked first, so a stray paste can never add a line to .env.
const KEY_SHAPE = /^[A-Za-z0-9._-]{20,400}$/;

type Chat = { session: AgentSession; tokens: TokenService };
type Route = (chat: Chat, req: Request) => Response | Promise<Response>;

export async function startApp(options: AppOptions): Promise<App> {
  const { model, geminiApiKey, geminiModel, livekitPort, port, room: roomName, keyGate, pickFolder, ...sessionOptions } = options;
  const configPath = sessionOptions.configPath ?? defaultConfigPath();
  const room = roomName ?? "live-agent";
  const livekit = await startLiveKit({ port: livekitPort });
  const cleanups: (() => Promise<unknown> | unknown)[] = [() => livekit.stop()];
  const stop = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  };

  // The chat: token service, agent session, and the core in the voice room.
  // Started now when there is a key, else once the window posts one.
  let chat: Chat | undefined;
  async function startChat(apiKey: string | undefined) {
    const tokens = createTokenService({ livekit, room, gemini: apiKey ? { apiKey, model: geminiModel } : undefined });
    const session = await startSession({
      ...sessionOptions,
      model: typeof model === "function" ? model(tokens) : model,
    });
    // All or nothing: if the core cannot join the room, close the session it
    // just opened, so a retry starts clean and nothing is left running.
    const join = async () =>
      joinVoiceRoom({ session, url: livekit.url, token: (await tokens.livekitToken("agent")).token });
    const bridge = await join().catch(async (err) => {
      await session.close().catch(() => {});
      throw err;
    });
    cleanups.push(() => session.close(), () => bridge.close());
    chat = { session, tokens };
  }

  try {
    if (geminiApiKey || !keyGate) await startChat(geminiApiKey);

    const launchToken = randomBytes(24).toString("hex");
    const allowed = (given: string | null) =>
      !!given && given.length === launchToken.length && timingSafeEqual(Buffer.from(given), Buffer.from(launchToken));

    // The pasted key passes through here once: checked, saved, used to start the
    // chat. No answer, log line or event carries it (spec story 12, ADR 0002).
    let checking = false;
    async function takeKey(req: Request): Promise<Response> {
      if (chat || !keyGate) return json({ error: "The key is already set. To change it, edit .env and restart." }, 409);
      if (checking) return json({ error: "Already checking a key." }, 409);
      // Set before the first await, so a double submit cannot start two chats.
      checking = true;
      try {
        const { key: pasted } = await readBody(req);
        const key = typeof pasted === "string" ? pasted.trim() : "";
        if (!KEY_SHAPE.test(key)) return json({ error: "That does not look like a Gemini key (it starts with AQ. or AIza, one word, no spaces). Copy it again from AI Studio." }, 400);
        const problem = await keyGate.check(key);
        if (problem) return json({ error: problem }, 400);
        await keyGate.save(key);
        await startChat(key);
        return json({ ok: true });
      } catch (err) {
        return json({ error: `Could not start: ${errorMessage(err)}` }, 500);
      } finally {
        checking = false;
      }
    }

    // The window's API, one entry per "METHOD /path" (see the list at the top).
    // All of these need the chat: before a key arrives they answer 503.
    const routes: Record<string, Route> = {
      async "GET /session"({ tokens }) {
        const { token, expiresAt } = await tokens.livekitToken("user");
        return json({ livekitUrl: livekit.url, room, identity: "user", token, expiresAt });
      },

      async "POST /text"({ session }, req) {
        const { text } = await readBody(req);
        if (typeof text !== "string" || !text.trim()) return json({ error: "send { text }" }, 400);
        return session.sendText(text).then((events) => json({ events }), refused);
      },

      // The window's Pause button (and Space): no voice out, no mic in, same chat.
      async "POST /pause"({ session }, req) {
        const { paused } = await readBody(req);
        if (typeof paused !== "boolean") return json({ error: "send { paused: true | false }" }, 400);
        session.setPaused(paused);
        return json({ paused: session.paused() });
      },

      // Esc in the window (ticket 37): stop the reply being spoken; the call stays on.
      async "POST /reply/stop"({ session }) {
        session.stopReply();
        return json({ ok: true });
      },

      // The window's New chat button: end this chat (note + tidy job), start the next.
      "POST /chat/new"({ session }) {
        return session.newChat().then(() => json({ ok: true }), refused);
      },

      // The safety mode (ticket 10). The window draws it from `mode.changed` events;
      // GET is for the first draw, and carries the modes and their labels for the dropdown.
      "GET /mode"({ session }) {
        return json({ mode: session.mode(), modes: MODES.map((id) => ({ id, label: MODE_LABELS[id] })) });
      },

      async "POST /mode"({ session }, req) {
        const body = await readBody(req);
        if (body.cycle === true) session.cycleMode();
        else if (typeof body.mode === "string" && (MODES as readonly string[]).includes(body.mode)) {
          session.setMode(body.mode as SafetyMode);
        } else {
          return json({ error: `send { mode: ${MODES.map((m) => `"${m}"`).join(" | ")} } or { cycle: true }` }, 400);
        }
        return json({ mode: session.mode() });
      },

      // The sidebar's brain tree and the read-only file view (ticket 23). The window
      // asks again on every `brain.write`, so new notes show up without a restart.
      async "GET /brain/tree"({ session }) {
        const { root, folders } = session.brain();
        return json(await brainTree(root, folders));
      },

      // The sidebar's past chats (ticket 24): the chat-end notes in raw, newest first.
      // The window reads one through GET /brain/file, and asks again on `chat.started`.
      async "GET /brain/chats"({ session }) {
        const { root, folders } = session.brain();
        return json({ chats: await pastChats(root, folders) });
      },

      async "GET /brain/file"({ session }, req) {
        const path = new URL(req.url).searchParams.get("path");
        if (!path) return json({ error: "send ?path=<a note inside the brain>" }, 400);
        const { root, folders } = session.brain();
        try {
          return json(await readBrainFile(root, path, folders));
        } catch (err) {
          if (err instanceof BrainPathError) return json({ error: err.message }, 400);
          if (err instanceof BrainFileMissing) return json({ error: err.message }, 404);
          throw err;
        }
      },

      "GET /events"({ session }) {
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
        return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
      },
    };

    // The setup wizard's routes. They need no chat: the wizard runs before the key
    // is in, and saving is plain typed answers (no model, nothing to mishear).
    const setupRoutes: Record<string, (req: Request) => Response | Promise<Response>> = {
      "GET /setup"() {
        try {
          return json({ needed: !existsSync(configPath), keyNeeded: !chat, configPath, current: currentConfig(configPath) });
        } catch (err) {
          return json({ error: errorMessage(err) }, 500);
        }
      },

      async "POST /setup/pick-folder"(req) {
        const { within } = await readBody(req);
        const root = typeof within === "string" && within.trim() ? brainRoot(within.trim()) : undefined;
        try {
          const path = await (pickFolder ?? macPickFolder)(root);
          if (!path) return json({ cancelled: true });
          if (!root) return json({ path });
          // A part's folder: anywhere inside the notes folder, stored relative to it.
          const relative = insideBrain(root, path);
          if (!relative) return json({ error: "Pick a folder inside your notes folder." }, 400);
          return json({ path, relative });
        } catch (err) {
          return json({ error: `Could not open the folder picker: ${errorMessage(err)}` }, 500);
        }
      },

      async "POST /setup/scan"(req) {
        const { path } = await readBody(req);
        if (typeof path !== "string" || !path.trim()) return json({ error: "send { path }" }, 400);
        try {
          const tree = await scanFolder(brainRoot(path.trim()));
          return json({ tree, parts: detectParts(tree.folders) });
        } catch {
          return json({ error: `${path} is not a folder I can open.` }, 400);
        }
      },

      async "POST /setup/save"(req) {
        let saved;
        try {
          saved = saveSetup(configPath, (await readBody(req)) as SetupAnswers);
        } catch (err) {
          return json({ error: errorMessage(err) }, err instanceof ConfigError ? 400 : 500);
        }
        if (chat) await chat.session.setup.apply(saved.config).catch(() => {});
        return json({ config: saved.config });
      },
    };

    // The job board's cancel button (ticket 10): a route with a value in its path.
    function cancelJob({ session }: Chat, id: string) {
      if (!session.jobs.list().some((job) => job.id === id)) return json({ error: `no job ${id}` }, 404);
      // false = it had already ended; the board already shows how.
      return json({ cancelled: session.jobs.cancel(id) });
    }

    // The approve / deny card (ticket 28): same as a spoken yes or no for that one call.
    // Unknown or already answered (by voice, text or an earlier click): 404, nothing happens.
    function answerCall({ session }: Chat, id: string, approve: boolean) {
      if (!session.answer(id, approve)) return json({ error: `no call ${id} is waiting for an answer` }, 404);
      return json({ answered: true, approve });
    }

    // Routes with a value in their path: POST /jobs/:id/cancel, POST /approvals/:id/approve|decline.
    function pathRoute(req: Request, url: URL): Route | undefined {
      if (req.method !== "POST") return undefined;
      const cancel = url.pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
      if (cancel) return (chat) => cancelJob(chat, decodeURIComponent(cancel[1]!));
      const answer = url.pathname.match(/^\/approvals\/([^/]+)\/(approve|decline)$/);
      if (answer) return (chat) => answerCall(chat, decodeURIComponent(answer[1]!), answer[2] === "approve");
      return undefined;
    }

    async function handle(req: Request, url: URL): Promise<Response> {
      if (req.method === "OPTIONS") return new Response(null, { status: 204 });
      // The manual voice check page holds no secrets; it reads the launch token from its URL hash.
      // Imported as text, so it is baked into the compiled sidecar (there is no src/ folder there).
      if (req.method === "GET" && url.pathname === "/check") {
        return new Response(checkPage as unknown as string, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
      const given = bearer ?? (url.pathname === "/events" ? url.searchParams.get("token") : null);
      if (!allowed(given)) return json({ error: "unauthorized" }, 401);

      const name = `${req.method} ${url.pathname}`;
      if (name === "GET /key") return json({ needed: !chat });
      if (name === "POST /key") return takeKey(req);
      const setupRoute = setupRoutes[name];
      if (setupRoute) return setupRoute(req);
      const route = routes[name] ?? pathRoute(req, url);
      if (!route) return json({ error: "not found" }, 404);
      if (!chat) return json({ error: "No Gemini key yet: paste it in the window." }, 503);
      return route(chat, req);
    }

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: port ?? 0,
      idleTimeout: 255, // seconds; the event stream also pings well inside this
      async fetch(req) {
        const res = await handle(req, new URL(req.url));
        for (const [name, value] of Object.entries(corsHeaders(req))) res.headers.set(name, value);
        return res;
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
