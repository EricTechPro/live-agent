// Ticket 40: the window while Jett cannot reach Gemini, or its core is being restarted.
// Calm "Reconnecting…" first (teal, a slow pulse, a turning arc, a "retrying in 5s" line);
// only when the retries run out a muted amber "Can't reach Gemini" with Retry.
import { describe, expect, test } from "bun:test";
import { callView, retryHint } from "../app/src/call-state.ts";
import { nextOrb, orbStart, RECONNECT_TRIES, type Orb, type OrbInput } from "../app/src/orb-state.ts";
import { waveFor } from "../app/src/orb-wave.ts";

const ready = (): Orb => nextOrb(orbStart, { type: "core.ready" }, 0);
const feed = (inputs: OrbInput[], from = ready(), now = 1000) => inputs.reduce((o, i) => nextOrb(o, i, now), from);
const lost = (attempt: number, retryInMs = 5000): OrbInput => ({ type: "connection", state: "reconnecting", attempt, retryInMs, message: "getaddrinfo ENOTFOUND" });

describe("orb while the network is gone", () => {
  test("a reconnecting event shows reconnecting, with when the next try is", () => {
    const orb = feed([lost(1, 5000)]);
    expect(orb).toEqual(expect.objectContaining({ state: "reconnecting", retryAt: 6000 }));
  });

  test("back: connected returns to listening", () => {
    expect(feed([lost(1), { type: "connection", state: "connected" }]).state).toBe("listening");
  });

  test("many tries in a row: it says it cannot reach Gemini, still retrying by itself", () => {
    const orb = feed([lost(RECONNECT_TRIES + 1, 30_000)]);
    expect(orb.state).toBe("offline");
    expect(orb.coreDead).toBeFalsy();
    expect(feed([{ type: "connection", state: "connected" }], orb).state).toBe("listening");
  });

  test("the shell restarting the core is reconnecting too; giving up is offline with a dead core", () => {
    const restarting = feed([{ type: "core.restarting", attempt: 2, retryInMs: 2000 }]);
    expect(restarting).toEqual(expect.objectContaining({ state: "reconnecting", retryAt: 3000 }));
    const down = feed([{ type: "core.down" }], restarting);
    expect(down).toEqual(expect.objectContaining({ state: "offline", coreDead: true }));
    expect(feed([{ type: "core.ready" }], down).state).toBe("listening");
  });

  test("a restart before the core was ever ready is reconnecting, not stuck on Starting", () => {
    expect(nextOrb(orbStart, { type: "core.restarting", attempt: 1, retryInMs: 1000 }, 0).state).toBe("reconnecting");
  });
});

describe("what the orb says", () => {
  test("Reconnecting… in the same small label, no buttons (Hang up stays in a call)", () => {
    expect(callView({ orb: "reconnecting", call: "off", muted: false })).toEqual({ look: "reconnecting", label: "Reconnecting…", buttons: [], mutedBadge: false });
    expect(callView({ orb: "reconnecting", call: "live", muted: false }).buttons).toEqual(["hangup"]);
    expect(callView({ orb: "reconnecting", call: "off", muted: false, lang: "zh" }).label).toBe("重新连接中…");
  });

  test("retries run out: Can't reach Gemini, with Retry", () => {
    const v = callView({ orb: "offline", call: "off", muted: false });
    expect(v).toEqual(expect.objectContaining({ look: "offline", label: "Can't reach Gemini", retry: "Retry" }));
    expect(callView({ orb: "offline", call: "off", muted: false, lang: "zh" })).toEqual(expect.objectContaining({ label: "连不上 Gemini", retry: "重试" }));
  });

  test("the faint line counts down to the next try", () => {
    const orb = feed([lost(1, 5000)]);
    expect(retryHint(orb, 1000, "en")).toBe("retrying in 5s");
    expect(retryHint(orb, 1400, "en")).toBe("retrying in 5s");
    expect(retryHint(orb, 5500, "zh")).toBe("1 秒后重试");
    expect(retryHint(orb, 6000, "en")).toBe("retrying…");
    expect(retryHint(ready(), 0, "en")).toBeUndefined();
  });
});

describe("the orb's wave while reconnecting", () => {
  test("a flat line in the orb's own colour, a slow soft pulse and an arc turning on the rim", () => {
    const a = waveFor({ look: "reconnecting", t: 0 });
    const b = waveFor({ look: "reconnecting", t: 1.2 });
    expect(a.kind).toBe("flat");
    expect(a.soft).toBe(true);
    expect(a.glow).toBeGreaterThanOrEqual(0.35);
    expect(a.glow).toBeLessThanOrEqual(0.65);
    expect(a.glow).not.toBe(b.glow);
    expect(a.arc).not.toBe(b.arc);
  });

  test("Can't reach Gemini: soft and still, no arc", () => {
    const w = waveFor({ look: "offline", t: 3 });
    expect(w).toEqual(expect.objectContaining({ kind: "flat", soft: true }));
    expect(w.arc).toBeUndefined();
    expect(waveFor({ look: "offline", t: 9 }).glow).toBe(w.glow);
  });

  test("reduced motion: nothing moves", () => {
    expect(waveFor({ look: "reconnecting", t: 0, still: true })).toEqual(waveFor({ look: "reconnecting", t: 5, still: true }));
  });
});
