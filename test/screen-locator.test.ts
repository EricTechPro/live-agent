// Finding real UI elements (slice 3, src/screen/locator.ts) with a fake helper: Accessibility
// first, OCR next, a grounding call last and snapped to a real control; ambiguity, misses and
// stale screenshots refused; 0-1000 grid boxes mapped to global points.
import { describe, expect, test } from "bun:test";
import type { AxHit, Eyes, FrontWindow, OcrLine } from "../src/screen/eyes.ts";
import type { ShotMap } from "../src/screen/geometry.ts";
import { parseGround } from "../src/screen/grounding.ts";
import { createLocator, gridBoxToPoints, NotFoundError, pick, shotProblem, snapToControl, type Ground } from "../src/screen/locator.ts";

const front: FrontWindow = { app: "Google Chrome", pid: 42, windowId: 7, title: "YouTube", bounds: { x: 100, y: 40, w: 1200, h: 800 } };
const subscribe: AxHit = { label: "Subscribe", role: "AXButton", frame: { x: 900, y: 600, w: 96, h: 36 }, exact: true };

interface FakeOpts {
  ax?: AxHit[];
  trusted?: boolean;
  ocr?: OcrLine[];
  controls?: AxHit[];
  fronts?: (FrontWindow | null)[];
  noAx?: boolean;
}

function fake(o: FakeOpts = {}) {
  const calls: string[] = [];
  let state = 0;
  const fronts = o.fronts ?? [front];
  const eyes: Pick<Eyes, "state" | "shot" | "ax" | "ocr"> = {
    async state() {
      calls.push("state");
      const f = fronts[Math.min(state++, fronts.length - 1)] ?? null;
      return { display: { x: 0, y: 0, w: 1512, h: 982 }, front: f };
    },
    async shot(opts = {}) {
      calls.push("shot");
      const r = opts.rect!;
      return { jpeg: new Uint8Array([1]), map: { origin: { x: r.x, y: r.y }, size: { w: r.w, h: r.h }, px: { w: r.w * 2, h: r.h * 2 } } };
    },
    ax: o.noAx
      ? undefined
      : {
          trusted: async () => o.trusted ?? true,
          request: async () => true,
          async find(text) {
            calls.push(`ax:${text}`);
            if (o.trusted === false) return { trusted: false, matches: [] };
            return { trusted: true, matches: (o.ax ?? []).filter((m) => m.label?.toLowerCase().includes(text.toLowerCase())) };
          },
          async controls() {
            calls.push("controls");
            return { trusted: o.trusted ?? true, controls: o.controls ?? [], texts: [] };
          },
        },
    async ocr({ text, accurate }) {
      calls.push(`ocr${accurate ? ":accurate" : ""}${text ? `:${text}` : ""}`);
      return { lines: o.ocr ?? [], area: front.bounds! };
    },
  };
  return { eyes, calls };
}

describe("tiers", () => {
  test("an Accessibility hit wins; OCR is only used for the words around it", async () => {
    const { eyes, calls } = fake({ ax: [subscribe] });
    const found = await createLocator({ eyes })({ text: "Subscribe" });
    expect(found).toMatchObject({ via: "ax", rect: subscribe.frame, role: "AXButton" });
    expect(calls.filter((c) => c.startsWith("ocr:")).length).toBe(0);
    expect(calls).not.toContain("shot");
  });

  test("OCR when Accessibility has nothing; words inside a real button become the button", async () => {
    const button: AxHit = { role: "AXButton", frame: { x: 400, y: 300, w: 120, h: 40 } };
    const { eyes } = fake({
      ocr: [{ text: "Scale 100%", frame: { x: 410, y: 310, w: 90, h: 18 }, match: { x: 410, y: 310, w: 40, h: 18 } }],
      controls: [button],
    });
    const found = await createLocator({ eyes })({ text: "Scale" });
    expect(found).toMatchObject({ via: "ocr", rect: button.frame });
  });

  test("OCR words with no control round them stay the words' own box", async () => {
    const { eyes } = fake({ ocr: [{ text: "Scale", frame: { x: 410, y: 310, w: 40, h: 18 } }] });
    expect(await createLocator({ eyes })({ text: "scale" })).toMatchObject({ via: "ocr", rect: { x: 410, y: 310, w: 40, h: 18 } });
  });

  test("fast OCR first, accurate only when fast misses", async () => {
    const { eyes, calls } = fake({ ocr: [] });
    await createLocator({ eyes })({ text: "Export" }).catch(() => {});
    expect(calls.filter((c) => c.startsWith("ocr:"))).toEqual(["ocr:Export", "ocr:accurate:Export"]);
  });

  test("grounding only after both miss, mapped through the shot and snapped to the control it lands on", async () => {
    const record: AxHit = { role: "AXButton", label: "Record", frame: { x: 700, y: 440, w: 44, h: 44 } };
    const { eyes, calls } = fake({ controls: [record] });
    const asked: string[] = [];
    // The front window is 1200x800 pt at (100,40); this box is 600..640 x 400..450 on the grid.
    const ground: Ground = async (_shot, d) => (asked.push(d), { box: [500, 500, 550, 540] });
    const found = await createLocator({ eyes, ground })({ describe: "the red record button" });
    expect(asked).toEqual(["the red record button"]);
    expect(found).toMatchObject({ via: "vision", rect: record.frame });
    expect(calls.indexOf("shot")).toBeGreaterThan(-1);
  });

  test("a describe-only target skips Accessibility and OCR", async () => {
    const { eyes, calls } = fake({ ax: [subscribe] });
    const ground: Ground = async () => ({ box: [0, 0, 100, 100] });
    await createLocator({ eyes, ground })({ describe: "the avatar" });
    expect(calls.some((c) => c.startsWith("ax:") || c.startsWith("ocr:"))).toBe(false);
  });

  test("Accessibility off: said once, then OCR does the work", async () => {
    let said = 0;
    const { eyes } = fake({ trusted: false, ocr: [{ text: "Export", frame: { x: 1, y: 2, w: 30, h: 10 } }] });
    const locate = createLocator({ eyes, onAxOff: () => said++ });
    expect((await locate({ text: "Export" })).via).toBe("ocr");
    await locate({ text: "Export" });
    expect(said).toBe(1);
  });
});

describe("never a guess", () => {
  test("two equal matches: an error asking for near or nth", async () => {
    const two = [subscribe, { ...subscribe, frame: { x: 900, y: 200, w: 96, h: 36 } }];
    const { eyes } = fake({ ax: two });
    const err = await createLocator({ eyes })({ text: "Subscribe" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toContain("more than once");
    expect(err.message).toContain("nth");
  });

  test("nth picks in reading order; near picks the closest", async () => {
    const top = { ...subscribe, frame: { x: 900, y: 200, w: 96, h: 36 } };
    const { eyes } = fake({ ax: [subscribe, top, { label: "Pricing", role: "AXLink", frame: { x: 880, y: 650, w: 60, h: 20 }, exact: true }] });
    const locate = createLocator({ eyes });
    expect((await locate({ text: "Subscribe", nth: 1 })).rect).toEqual(top.frame);
    expect((await locate({ text: "Subscribe", near: "Pricing" })).rect).toEqual(subscribe.frame);
  });

  test("not on screen anywhere: an error, no rect", async () => {
    const { eyes } = fake();
    const err = await createLocator({ eyes, ground: async () => null })({ text: "Export" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toContain("Can't find");
  });

  test("the window moved while the model looked: refused", async () => {
    const moved = { ...front, bounds: { ...front.bounds!, x: 300 } };
    const { eyes } = fake({ fronts: [front, moved] });
    const err = await createLocator({ eyes, ground: async () => ({ box: [1, 1, 50, 50] }) })({ describe: "the logo" }).catch((e) => e);
    expect(err.message).toContain("moved");
  });

  test("shotProblem: too old, other window, moved, new page", () => {
    const at = 1000;
    expect(shotProblem({ at, front }, { at: at + 500, front })).toBeUndefined();
    expect(shotProblem({ at, front }, { at: at + 20_000, front })).toContain("too old");
    expect(shotProblem({ at, front }, { at, front: { ...front, windowId: 9 } })).toContain("changed");
    expect(shotProblem({ at, front }, { at, front: { ...front, bounds: { ...front.bounds!, h: 700 } } })).toContain("moved");
    expect(shotProblem({ at, front }, { at, front: { ...front, title: "Other" } })).toContain("page changed");
  });

  test("the grounding answer is checked: no box, a flat box or out-of-range numbers are not found", () => {
    expect(parseGround('{"found":true,"box_2d":[100,200,300,400],"label":"Export"}')).toEqual({ box: [100, 200, 300, 400], label: "Export" });
    expect(parseGround('{"found":false}')).toBeNull();
    expect(parseGround('{"found":true,"box_2d":[300,200,100,400]}')).toBeNull();
    expect(parseGround('{"found":true,"box_2d":[0,0,1200,10]}')).toBeNull();
    expect(parseGround("not json")).toBeNull();
  });
});

describe("coordinates", () => {
  const box: [number, number, number, number] = [250, 500, 500, 750]; // ymin xmin ymax xmax
  test("scale 1: grid -> pixels -> points", () => {
    const map: ShotMap = { origin: { x: 0, y: 0 }, size: { w: 1000, h: 800 }, px: { w: 1000, h: 800 } };
    expect(gridBoxToPoints(map, box)).toEqual({ x: 500, y: 200, w: 250, h: 200 });
  });
  test("scale 2 (Retina) gives the same points", () => {
    const map: ShotMap = { origin: { x: 0, y: 0 }, size: { w: 1000, h: 800 }, px: { w: 2000, h: 1600 } };
    expect(gridBoxToPoints(map, box)).toEqual({ x: 500, y: 200, w: 250, h: 200 });
  });
  test("a shrunk shot of a window on a display left of the main one (negative origin)", () => {
    const map: ShotMap = { origin: { x: -1440, y: 100 }, size: { w: 1440, h: 900 }, px: { w: 1568, h: 980 } };
    const r = gridBoxToPoints(map, [0, 0, 1000, 500]);
    expect(r.x).toBeCloseTo(-1440);
    expect(r.y).toBeCloseTo(100);
    expect(r.w).toBeCloseTo(720);
    expect(r.h).toBeCloseTo(900);
  });
  test("snap: best overlap, else the control holding the centre, else nothing", () => {
    const a: AxHit = { role: "AXButton", frame: { x: 100, y: 100, w: 80, h: 30 } };
    const big: AxHit = { role: "AXGroup", frame: { x: 0, y: 0, w: 1000, h: 1000 } };
    expect(snapToControl({ x: 104, y: 98, w: 70, h: 32 }, [big, a])).toBe(a);
    expect(snapToControl({ x: 110, y: 105, w: 40, h: 20 }, [a])).toBe(a);
    expect(snapToControl({ x: 600, y: 600, w: 40, h: 40 }, [a, big])).toBeUndefined();
  });
  test("pick: exact beats partial; one control found twice counts once", () => {
    const partial = { frame: { x: 0, y: 0, w: 10, h: 10 }, exact: false };
    const exact = { frame: { x: 50, y: 0, w: 10, h: 10 }, exact: true };
    expect(pick([partial, exact])).toBe(exact);
    expect(pick([exact, { ...exact, frame: { x: 51, y: 0, w: 10, h: 10 } }])).toBe(exact);
  });
});

describe("what is around the target", () => {
  test("controls count as busy (the chip keeps off them), big containers do not; the window's boxes go out", async () => {
    const back: AxHit = { role: "AXButton", label: "Back", frame: { x: 860, y: 600, w: 34, h: 34 } };
    const group: AxHit = { role: "AXRow", frame: { x: 100, y: 40, w: 1200, h: 700 } };
    const { eyes } = fake({ ax: [subscribe], controls: [subscribe, back, group], ocr: [{ text: "182K", frame: { x: 900, y: 640, w: 40, h: 12 } }] });
    let sent: unknown[] = [];
    const found = await createLocator({ eyes, onBoxes: (b) => (sent = b) })({ text: "Subscribe" });
    expect(found.texts).toContainEqual(back.frame);
    expect(found.texts).toContainEqual({ x: 900, y: 640, w: 40, h: 12 });
    expect(found.texts).not.toContainEqual(group.frame);
    expect(found.texts).not.toContainEqual(subscribe.frame);
    expect(sent).toContainEqual(back.frame);
  });
});
