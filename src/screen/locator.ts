// Finding real UI elements (slice 3): the model names a target by its words or a
// description, and code finds WHERE it is. Three tiers, first hit wins:
//
//   1. Accessibility: the front window's controls whose label, title or value hold the words
//   2. OCR: on-device Vision text in the front window (fast, then accurate)
//   3. Grounding: one fresh screenshot of the front window to a Gemini Flash call that
//      answers a box on the 0-1000 grid; mapped to points, snapped to the control it lands on
//
// Never a guess: nothing found is an error the model hears. Two equal matches are an error
// asking for `near` or `nth`. A grounding answer is refused when its screenshot is too old
// or the window moved or changed while the model looked.
//
//   const locate = createLocator({ eyes, ground });
//   const found = await locate({ text: "Subscribe" });   // { rect (global points), via, ... }
//
// Idea from Roamies (AGPL): idea only, our own code.
import type { AxHit, Eyes, FrontWindow, OcrLine, Shot } from "./eyes.ts";
import { pixelRectToPoints, type Pt, type Rect, type ShotMap } from "./geometry.ts";

export interface Target {
  /** Words shown on it (a button's label, a field's name, a link's text). */
  text?: string;
  /** What it looks like, when it has no words ("the red record button", "the profile picture"). */
  describe?: string;
  /** Words next to it, to choose between two matches. */
  near?: string;
  /** Which match, 1 = the top-most (then left-most). */
  nth?: number;
}

export interface Found {
  /** Global points. */
  rect: Rect;
  via: "ax" | "ocr" | "vision";
  label?: string;
  role?: string;
  /** The front window it was found in: marks on it go stale when it changes. */
  front: FrontWindow | null;
  /** Word boxes around it (global points), so a label chip can cover as few as possible. */
  texts: Rect[];
}

/** One grounding answer: a box on the 0-1000 grid, [ymin, xmin, ymax, xmax] (Gemini's box_2d). */
export type Ground = (shot: Shot, describe: string) => Promise<{ box: [number, number, number, number]; label?: string } | null>;

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface LocatorDeps {
  eyes: Pick<Eyes, "state" | "shot" | "ax" | "ocr">;
  ground?: Ground;
  /** Accessibility is off: say so once (the window shows how to turn it on). */
  onAxOff?(): void;
  now?: () => number;
}

// ---- pure parts (test/screen-locator.test.ts) --------------------------------------------

/** Lower case, one space, no trailing punctuation or ellipsis: "Save as…" ~ "save as". */
export const norm = (s: string) =>
  s.toLowerCase().replace(/…/g, "").replace(/\s+/g, " ").trim().replace(/^[.:,;!?]+|[.:,;!?]+$/g, "");

/** A 0-1000 grid box [ymin, xmin, ymax, xmax] on a shot, in global points. */
export function gridBoxToPoints(map: ShotMap, box: [number, number, number, number]): Rect {
  const [y0, x0, y1, x1] = box.map((v) => Math.min(1000, Math.max(0, v))) as [number, number, number, number];
  const px = {
    x: (Math.min(x0, x1) / 1000) * map.px.w,
    y: (Math.min(y0, y1) / 1000) * map.px.h,
    w: (Math.abs(x1 - x0) / 1000) * map.px.w,
    h: (Math.abs(y1 - y0) / 1000) * map.px.h,
  };
  return pixelRectToPoints(map, px);
}

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
export function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export const iou = (a: Rect, b: Rect) => {
  const i = intersection(a, b);
  return i ? i / (area(a) + area(b) - i) : 0;
};
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const contains = (r: Rect, p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * The real control a guessed box means: the best overlap (IoU over 0.35 and a size within
 * 0.4x to 2.5x), else the smallest control holding the box's centre (not much bigger than
 * it), else the nearest control whose centre is within 16 pt. Undefined: keep the guess.
 */
export function snapToControl(guess: Rect, controls: readonly AxHit[]): AxHit | undefined {
  const size = area(guess) || 1;
  let best: { hit: AxHit; score: number } | undefined;
  for (const c of controls) {
    const ratio = area(c.frame) / size;
    const score = iou(guess, c.frame);
    if (score > 0.35 && ratio >= 0.4 && ratio <= 2.5 && (!best || score > best.score)) best = { hit: c, score };
  }
  if (best) return best.hit;
  const holding = controls
    .filter((c) => contains(c.frame, centre(guess)) && area(c.frame) <= size * 6)
    .sort((a, b) => area(a.frame) - area(b.frame));
  if (holding[0]) return holding[0];
  const g = centre(guess);
  const near = controls
    .map((c) => ({ c, d: Math.hypot(centre(c.frame).x - g.x, centre(c.frame).y - g.y) }))
    .filter((x) => x.d <= 16 && area(x.c.frame) <= size * 6)
    .sort((a, b) => a.d - b.d);
  return near[0]?.c;
}

/** Why a screenshot can't be trusted for coordinates now, or undefined. */
export function shotProblem(
  shot: { at: number; front: FrontWindow | null },
  now: { at: number; front: FrontWindow | null },
  maxAgeMs = 15_000,
): string | undefined {
  if (now.at - shot.at > maxAgeMs) return "the screenshot is too old";
  const a = shot.front;
  const b = now.front;
  if (!a || !b) return a === b ? undefined : "the window changed since the screenshot";
  if (a.pid !== b.pid || (a.windowId !== undefined && b.windowId !== undefined && a.windowId !== b.windowId)) return "the window changed since the screenshot";
  const ab = a.bounds;
  const bb = b.bounds;
  if (ab && bb && (Math.abs(ab.x - bb.x) > 2 || Math.abs(ab.y - bb.y) > 2 || Math.abs(ab.w - bb.w) > 2 || Math.abs(ab.h - bb.h) > 2))
    return "the window moved since the screenshot";
  if ((a.title ?? "") !== (b.title ?? "")) return "the page changed since the screenshot";
  return undefined;
}

export interface Candidate {
  frame: Rect;
  label?: string;
  role?: string;
  exact?: boolean;
}

/**
 * Choose one match. Exact words beat partial ones. With `nth`: that one in reading order.
 * With `near` (a point): the closest. Else exactly one must be left, or it is ambiguous.
 */
export function pick<T extends Candidate>(hits: readonly T[], opts: { nth?: number; near?: Pt } = {}): T | "ambiguous" | undefined {
  if (!hits.length) return undefined;
  const exact = hits.filter((h) => h.exact);
  // The same thing found twice (a control and its own words): one.
  const pool = dedupe(exact.length ? exact : [...hits]);
  if (opts.near) {
    const n = opts.near;
    return [...pool].sort((a, b) => Math.hypot(centre(a.frame).x - n.x, centre(a.frame).y - n.y) - Math.hypot(centre(b.frame).x - n.x, centre(b.frame).y - n.y))[0];
  }
  if (opts.nth) {
    const order = [...pool].sort((a, b) => (Math.abs(a.frame.y - b.frame.y) > 6 ? a.frame.y - b.frame.y : a.frame.x - b.frame.x));
    return order[opts.nth - 1];
  }
  return pool.length === 1 ? pool[0] : "ambiguous";
}

function dedupe<T extends Candidate>(hits: T[]): T[] {
  const out: T[] = [];
  for (const h of hits) if (!out.some((o) => iou(o.frame, h.frame) > 0.6)) out.push(h);
  return out;
}

/** OCR lines that hold the words: whole words (the helper's `match` box), or the line itself equal to them. */
export function ocrHits(lines: readonly OcrLine[], text: string): Candidate[] {
  const q = norm(text);
  return lines.flatMap((l) => {
    if (l.match) return [{ frame: l.match, label: l.text, exact: norm(l.text) === q }];
    if (norm(l.text) === q) return [{ frame: l.frame, label: l.text, exact: true }];
    return [];
  });
}

/** Word boxes near a rect (not on it), for the label chip. */
export function textsAround(rect: Rect, boxes: readonly Rect[], reach = 220): Rect[] {
  const zone = { x: rect.x - reach, y: rect.y - reach / 2, w: rect.w + reach * 2, h: rect.h + reach };
  return boxes.filter((b) => intersection(b, zone) > 0 && iou(b, rect) < 0.5 && !(contains(rect, centre(b)))).slice(0, 100);
}

// ---- the locator --------------------------------------------------------------------

const quote = (t: Target) => `"${t.text ?? t.describe}"`;

export function createLocator(deps: LocatorDeps): (target: Target) => Promise<Found> {
  const { eyes } = deps;
  const now = deps.now ?? Date.now;
  let axOffSaid = false;

  async function where(near: string | undefined, front: FrontWindow | null): Promise<Pt | undefined> {
    if (!near) return undefined;
    const ax = eyes.ax ? await eyes.ax.find(near).catch(() => undefined) : undefined;
    const hit = ax?.matches[0] ?? (eyes.ocr ? ocrHits((await eyes.ocr({ rect: front?.bounds, text: near }).catch(() => ({ lines: [] }))).lines, near)[0] : undefined);
    return hit ? centre(hit.frame) : undefined;
  }

  return async function locate(target) {
    if (!target.text && !target.describe) throw new NotFoundError("Say what to find: its words (text) or what it looks like (describe).");
    const state = await eyes.state({ url: false });
    const front = state.front;
    const scope = front?.bounds ?? state.display;
    const nearPt = await where(target.near, front);
    const opts = { nth: target.nth, near: nearPt };
    const ambiguous = (n: string) =>
      new NotFoundError(`${quote(target)} is on screen more than once (${n}): add near (words next to the one you mean) or nth (1 = top-most).`);
    let ocrLines: OcrLine[] | undefined;
    let controls: AxHit[] | undefined;
    let axTexts: Rect[] = [];

    const finish = async (rect: Rect, via: Found["via"], label?: string, role?: string): Promise<Found> => {
      // Words around it for the chip: the OCR already read, else a quick read round it.
      let boxes = ocrLines?.map((l) => l.frame);
      if (!boxes && eyes.ocr) {
        const pad = { x: rect.x - 240, y: rect.y - 120, w: rect.w + 480, h: rect.h + 240 };
        boxes = (await eyes.ocr({ rect: pad }).catch(() => ({ lines: [] as OcrLine[] }))).lines.map((l) => l.frame);
      }
      return { rect, via, label, role, front, texts: textsAround(rect, [...(boxes ?? []), ...axTexts]) };
    };

    // 1. Accessibility.
    if (target.text && eyes.ax) {
      const r = await eyes.ax.find(target.text).catch(() => undefined);
      if (r && !r.trusted && !axOffSaid) {
        axOffSaid = true;
        deps.onAxOff?.();
      }
      const hits = (r?.matches ?? []).filter((m) => intersection(m.frame, scope) > 0);
      const one = pick(hits, opts);
      if (one === "ambiguous") throw ambiguous(`${hits.length} controls`);
      if (one) return finish(one.frame, "ax", one.label, one.role);
    }

    // 2. OCR: fast, then accurate.
    if (target.text && eyes.ocr) {
      for (const accurate of [false, true]) {
        const r = await eyes.ocr({ rect: scope, text: target.text, accurate }).catch(() => undefined);
        if (!r) continue;
        ocrLines = r.lines;
        const hits = ocrHits(r.lines, target.text);
        const one = pick(hits, opts);
        if (one === "ambiguous") throw ambiguous(`${hits.length} places`);
        if (one) {
          // Words inside a button: the button is the thing (when Accessibility can see it).
          controls ??= eyes.ax ? await eyes.ax.controls().then((c) => ((axTexts = c.texts), c.controls)).catch(() => []) : [];
          const control = controls.find((c) => contains(c.frame, centre(one.frame)) && area(c.frame) <= area(one.frame) * 12);
          return control ? finish(control.frame, "ocr", one.label, control.role) : finish(one.frame, "ocr", one.label);
        }
      }
    }

    // 3. Grounding: a fresh shot of the front window, one Gemini call, snapped to a real control.
    const describe = target.describe ?? target.text!;
    if (deps.ground) {
      const shotAt = now();
      const shot = await eyes.shot({ rect: scope, maxPx: 1568 });
      const answer = await deps.ground(shot, target.text && target.describe ? `${target.describe} (it says "${target.text}")` : describe);
      if (answer) {
        const after = await eyes.state({ url: false });
        const problem = shotProblem({ at: shotAt, front }, { at: now(), front: after.front });
        if (problem) throw new NotFoundError(`Not marking ${quote(target)}: ${problem}. Look again and retry.`);
        const guess = gridBoxToPoints(shot.map, answer.box);
        if (intersection(guess, scope) <= 0 || guess.w < 2 || guess.h < 2) throw new NotFoundError(`Can't find ${quote(target)} on screen.`);
        controls ??= eyes.ax ? await eyes.ax.controls().then((c) => ((axTexts = c.texts), c.controls)).catch(() => []) : [];
        const snapped = snapToControl(guess, controls);
        return snapped ? finish(snapped.frame, "vision", answer.label ?? snapped.label, snapped.role) : finish(guess, "vision", answer.label);
      }
    }
    throw new NotFoundError(
      `Can't find ${quote(target)} on screen${front ? ` in ${front.app}` : ""}. Say its exact words, describe it, or ask the user to bring it into view.`,
    );
  };
}
