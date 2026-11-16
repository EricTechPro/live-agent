# 37: Phone-call controls, cues, push to talk, reply in the user's language

**What to build:** Make it obvious whether Jett is listening. A call works like a phone call: not in a call, one Start call button; in a call, exactly Mute and a red Hang up. No pause the user sees. The orb says its state in plain words ("Tap to talk", "Listening…", "Thinking…", "Speaking…", "Muted", "Call ended") with its own colour and motion per state, and pulses with the user's voice. Cues beside the orb: equaliser pill, working pill naming the action, speech bubble. Hold Ctrl+Option anywhere to talk. Esc stops a reply. Jett answers in the language the user spoke, and the window's state words follow (English and Chinese). See the spec addendum "Calls like a phone call".

**Blocked by:** 26 Icon call controls

**Status:** ready-for-human

**Priority:** must-have

- [x] Not in a call: one Start call button (and clicking the orb starts a call)
- [x] In a call: Mute (mic-slash when muted) and a red Hang up, nothing else; Mute stops the mic in the window, the core keeps running
- [x] Plain state words and a different orb colour and motion for idle, listening, thinking, speaking, muted and call ended; listening swells with the mic level
- [x] Cues: equaliser pill with your words, working pill naming the action, speech bubble with a tail and a chevron for long replies; pure code with tests
- [x] Space starts a call or mutes / unmutes; Cmd+. hangs up; Esc stops a reply (core `POST /reply/stop`, tested on the event stream), else hangs up; tooltips show the keys
- [x] Hold Ctrl+Option to talk, let go to send; Ctrl+Option+S shows / hides Jett; the push-to-talk steps are pure code with tests
- [x] Core events plus call and mute map to the label, look and buttons in a pure function with tests
- [x] The system prompt tells Jett to answer in the language the user spoke, with a test; the window's words follow the user's language (en, zh)
- [ ] Hand check in the real app: start a call, speak Chinese, hear a Chinese answer, mute, hang up; hold Ctrl+Option from another app and talk; Esc while Jett talks

## Comments

- 2026-11-15: why v2 went to "Paused" by itself: the core only pauses on the window's `/pause`. Space toggled pause whenever focus was not in a text field or button, and on macOS WebKit a clicked button never takes focus, so after clicking Start call a Space press paused Jett. v3 drops pause from the window.
- 2026-11-15: built (agent). `app/src/call-state.ts`, `app/src/cues.ts`, `app/src/captions.ts`, `app/src/lang.ts`, `app/src/mic-level.ts`, push to talk in `app/src/overlay.ts`; tests in `test/call-state.test.ts`, `test/cues.test.ts`, `test/captions.test.ts`, `test/mic-level.test.ts`, `test/overlay.test.ts`, `test/stop-reply.test.ts`, `test/reply-language.test.ts`. Push to talk reads the macOS modifier flags (`CGEventSourceFlagsState`) in the overlay poll. Risks for the hand check: whether WebKit lets a call started from the hotkey (not a click) play Jett's voice (`room.startAudio` outside a user gesture), and whether Gemini ends the turn well after the mic closes 1.2 s after you let go.
