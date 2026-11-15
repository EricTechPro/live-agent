# 37: Phone-call controls, plain state words, reply in the user's language

**What to build:** Make it obvious whether Jett is listening. A call works like a phone call: not in a call, one Start call button; in a call, exactly Mute and a red Hang up. No pause the user sees. The orb says its state in plain words ("Tap to talk", "Listening…", "Thinking…", "Speaking…", "Muted", "Call ended") with its own colour and motion per state, and pulses with the user's voice. Jett answers in the language the user spoke, and the window's state words follow (English and Chinese). See the spec addendum "Calls like a phone call".

**Blocked by:** 26 Icon call controls

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Not in a call: one Start call button (and clicking the orb starts a call)
- [ ] In a call: Mute (mic-slash when muted) and a red Hang up, nothing else; Mute stops the mic in the window, the core keeps running
- [ ] Plain state words and a different orb colour and motion for idle, listening, thinking, speaking, muted and call ended; listening pulses with the mic level
- [ ] Space starts a call or mutes / unmutes; Cmd+. hangs up, Esc too when nothing else is open; tooltips show the keys
- [ ] Core events plus call and mute map to the label, look and buttons in a pure function with tests
- [ ] The system prompt tells Jett to answer in the language the user spoke, with a test; the window's words follow the user's language (en, zh)
- [ ] Hand check in the real app: start a call, speak Chinese, hear a Chinese answer, mute, hang up

## Comments

- 2026-11-15: why v2 went to "Paused" by itself: the core only pauses on the window's `/pause`. Space toggled pause whenever focus was not in a text field or button, and on macOS WebKit a clicked button never takes focus, so after clicking Start call a Space press paused Jett. v3 drops pause from the window.
