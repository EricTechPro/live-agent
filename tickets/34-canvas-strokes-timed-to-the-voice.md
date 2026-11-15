# 34: Canvas strokes timed to the spoken line

**What to build:** Each beat's strokes start when Jett starts saying that beat's `say` line and spread across the time it takes to say it. The core marks which beat is being spoken (for example a `canvas.speak` event with the beat index, from the model's output transcript matching the `say` text), and the window paces the pen to it. With no timing signal (text turns), beats draw one after another at a fixed pace.

**Blocked by:** 32 Sketch canvas renderer with pen animation

**Status:** ready-for-agent

**Priority:** after-talk

- [ ] The core emits a beat-start signal as each `say` line begins to be spoken (scripted fake model test with output transcript chunks)
- [ ] The window starts a beat's strokes on its signal and finishes them about when the line ends
- [ ] An interruption stops the pen; the beats not yet drawn stay undrawn
- [ ] Text turns without audio still draw every beat
- [ ] Hand check in the real app: strokes land with the words

## Comments
