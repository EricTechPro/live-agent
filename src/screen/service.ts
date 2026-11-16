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
   * Did the user talk since `since` (ms, Date.now())? Read from the mic audio itself (it reaches
   * the core while the keys are held), so it never waits on a transcript. A hold with no voice
   * and no circle sends nothing, so an accidental Ctrl+Option never makes Jett talk.
   */
  spokeSince(since: number): boolean;
  /**
   * Least time between the circled crop going in and its label (ms). Default 1500. Why: Live
   * takes a frame in on its own clock; text sent right behind it is answered before the image
   * is seen (a real run said "I can't see that clearly" with no gap, named the photo with 2 s).
   */
  frameGapMs?: number;
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
  /**
   * The ink closed into a loop while the keys are still held: send the crop now, as its own
   * image, so it is in before the spoken question ends. Once per hold; `release` does it if
   * this was never called.
   */
  circle(stroke: Pt[]): Promise<{ circled: boolean }>;
  release(input: ReleaseInput): Promise<{ sent: boolean; circled: boolean; text?: string }>;
  permission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
}

/** The words that go with a circled crop. No app or window: the circle is the subject. */
export function circleLabel(where: string, cursor?: Pt): string {
  const at = cursor ? ` The pointer is at (${Math.round(cursor.x)}, ${Math.round(cursor.y)}).` : "";
  return (
    `[Circled: the image just sent is the region the user just circled (${where.replace(/^I circled something /, "").replace(/\.$/, "")}), ` +
    `with their teal pen mark on it. Answer about what is inside the circle, not about the app or window.${at}]`
  );
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

  // The circle sent in the hold now going on: when, and the sentence saying where.
  let sent: { at: number; where: string; imageAt: number; done: Promise<void> } | undefined;
  const frameGapMs = deps.frameGapMs ?? 1500;

  function circle(stroke: Pt[]): Promise<{ circled: boolean }> {
    const loop = findLoop(stroke);
    if (!loop) return Promise.resolve({ circled: false });
    const mine = { at: Date.now(), where: "", imageAt: 0, done: Promise.resolve() };
    sent = mine;
    mine.done = guarded(async () => {
      const now = await state();
      if (!now) throw new Error("could not read the screen layout");
      const shot = await eyes.shot({ rect: inkCrop(loop, now.display), ink: [stroke] });
      deps.sendImage(shot.jpeg, "image/jpeg");
      mine.imageAt = Date.now();
      mine.where = circleSentence(loop, now.display);
      emit({ type: "screen.shot", reason: "circle", width: shot.map.px.w, height: shot.map.px.h, map: shot.map, text: mine.where });
    });
    return mine.done.then(() => ({ circled: true }));
  }

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

    circle,

    async release({ stroke = [], cursor, holdMs = 0 }) {
      const holdStart = Date.now() - holdMs - 300;
      // The window sends the circle as soon as it closes; if it did not, do it now.
      if (!(sent && sent.at >= holdStart)) await circle(stroke);
      const mine = sent && sent.at >= holdStart ? sent : undefined;
      sent = undefined;
      if (mine) {
        await mine.done;
        const wait = mine.imageAt + frameGapMs - Date.now();
        if (wait > 0) await Bun.sleep(wait);
        // A circle turn carries only the circle's label: app and window would pull the answer away.
        const text = circleLabel(mine.where, cursor);
        deps.sendText(text);
        return { sent: true, circled: true, text };
      }
      if (!deps.spokeSince(holdStart)) return { sent: false, circled: false };
      const text = contextLine(await state(), cursor);
      if (!text) return { sent: false, circled: false };
      deps.sendText(text);
      return { sent: true, circled: false, text };
    },

    permission: () => eyes.permission(),
    requestPermission: () => eyes.requestPermission(),
  };
}
