# 34: Canvas strokes timed to the spoken line

**What to build:** Each beat's strokes start when Jett starts saying that beat's `say` line and spread across the time it takes to say it. The core marks which beat is being spoken (for example a `canvas.speak` event with the beat index, from the model's output transcript matching the `say` text), and the window paces the pen to it. With no timing signal (text turns), beats draw one after another at a fixed pace.

**Blocked by:** 32 Sketch canvas renderer with pen animation

**Status:** done

**Priority:** after-talk

- [x] The core emits a beat-start signal as each `say` line begins to be spoken (scripted fake model test with output transcript chunks)
- [x] The window starts a beat's strokes on its signal and finishes them about when the line ends
- [x] An interruption stops the pen; the beats not yet drawn stay undrawn
- [x] Text turns without audio still draw every beat
- [ ] Hand check in the real app: strokes land with the words

## Comments

- 2026-11-15: The signal is `canvas.speak` from the output transcript (a line starts once its first three words are heard; skipped lines are signalled in order). The pen clock is text-based (`app/src/pen.ts`: caption length / 15 chars a second, `beatMs` takes the rate as the hook for real audio timing). Unsignalled beats wait 1.5 s after the beat before, then draw. The hand check is still open.
