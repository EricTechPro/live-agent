// The screen service: what the core does with Jett's eyes.
//
//   look()         the `look` tool: one screenshot of the main display into the Live session
//   note(cursor)   the text every user turn carries: front app, window title, URL, cursor
//   release(...)   Ctrl+Option let go: a closed loop drawn while holding it becomes a crop
//                  (with the ink on it) plus "I circled something at the top left"
//
// Images go in as Live video frames (sendImage); the words go in as text. Nothing is
// captured unless the model asks or the user circles: no stream, no background capture.
import type { AgentEvent } from "../core/events.ts";
import { ScreenPermissionError, type Eyes, type ScreenState } from "./eyes.ts";
import { circleSentence, findLoop, inkCrop, type Pt } from "./geometry.ts";

export interface ScreenDeps {
  eyes: Eyes;
  sendImage(jpeg: Uint8Array, mimeType: string): void;
  sendText(text: string): void;
  emit(event: AgentEvent): void;
  /**
   * Did the user say anything since `since` (ms, Date.now())? Waits up to `waitMs` for the
   * transcription to arrive. A hold with no words and no circle sends nothing, so an
   * accidental Ctrl+Option never makes Jett talk.
   */
  heardSince(since: number, waitMs: number): Promise<boolean>;
}

export interface ReleaseInput {
  /** The cursor path while Ctrl+Option was held, global points. */
  stroke?: Pt[];
  /** Where the cursor was on release, global points. */
  cursor?: Pt;
  /** How long the keys were held (ms). */
  holdMs?: number;
}

export interface Screen {
  look(): Promise<Record<string, unknown>>;
  note(cursor?: Pt): Promise<string>;
  release(input: ReleaseInput): Promise<{ sent: boolean; circled: boolean; text?: string }>;
  permission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
}

/** "[Screen: Google Chrome, window "Pricing", https://x.com · cursor at (812, 440)]" */
export function contextLine(state: ScreenState | null, cursor?: Pt): string {
  const bits: string[] = [];
  const front = state?.front;
  if (front) {
    let where = `front app ${front.app}`;
    if (front.title) where += `, window "${front.title}"`;
    if (front.url) where += `, ${front.url}`;
    bits.push(where);
  }
  if (cursor) bits.push(`cursor at (${Math.round(cursor.x)}, ${Math.round(cursor.y)})`);
  if (state?.display) bits.push(`screen ${state.display.w}x${state.display.h} points`);
  return bits.length ? `[Screen: ${bits.join(" · ")}]` : "";
}

export function createScreen(deps: ScreenDeps): Screen {
  const { eyes, emit } = deps;

  // A permission problem goes on the stream (the window shows how to fix it) and to the model.
  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof ScreenPermissionError) emit({ type: "screen.permission", granted: false, message: err.message });
      throw err;
    }
  }

  const state = () => eyes.state().catch(() => null);

  return {
    async note(cursor) {
      return contextLine(await state(), cursor);
    },

    look: () =>
      guarded(async () => {
        const [shot, now] = await Promise.all([eyes.shot(), state()]);
        deps.sendImage(shot.jpeg, "image/jpeg");
        emit({ type: "screen.shot", reason: "look", width: shot.map.px.w, height: shot.map.px.h, map: shot.map });
        const front = now?.front;
        return {
          image: `The screenshot (${shot.map.px.w}x${shot.map.px.h} px, Jett's own windows left out) is the image just sent. Answer from it.`,
          ...(front ? { app: front.app, window: front.title, url: front.url } : {}),
        };
      }),

    async release({ stroke = [], cursor, holdMs = 0 }) {
      const loop = findLoop(stroke);
      if (!loop && !(await deps.heardSince(Date.now() - holdMs - 500, 1500))) return { sent: false, circled: false };
      const now = await state();
      const lines: string[] = [];
      if (loop && now) {
        const rect = inkCrop(loop, now.display);
        await guarded(async () => {
          // The ink as drawn (run-up and all), framed on the loop.
          const shot = await eyes.shot({ rect, ink: [stroke] });
          deps.sendImage(shot.jpeg, "image/jpeg");
          const text = circleSentence(loop, now.display);
          emit({ type: "screen.shot", reason: "circle", width: shot.map.px.w, height: shot.map.px.h, map: shot.map, text });
          lines.push(`${text} The image I just sent is that area with my pen mark drawn on it in teal. That's what I mean.`);
        });
      }
      const line = contextLine(now, cursor);
      if (line) lines.push(line);
      if (!lines.length) return { sent: false, circled: !!loop };
      const text = lines.join("\n");
      deps.sendText(text);
      return { sent: true, circled: !!loop, text };
    },

    permission: () => eyes.permission(),
    requestPermission: () => eyes.requestPermission(),
  };
}
