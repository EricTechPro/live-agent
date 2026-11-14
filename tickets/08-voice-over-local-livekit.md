# 08: Voice over local LiveKit with ephemeral tokens

**What to build:** The user talks and hears the agent in real time. Audio travels over a LiveKit server that runs on the user's own machine (dev mode, bundled), so no LiveKit account is needed. A local token service mints ephemeral Gemini and LiveKit tokens; the real Gemini key never reaches the front end. The user can interrupt the agent mid-sentence.

**Blocked by:** 01 Text turn through the agent core

**Status:** ready-for-human

**Priority:** must-have

- [x] Starting live-agent starts the local LiveKit server and stops it on exit
- [ ] A spoken turn gets a spoken reply in real time
- [ ] Speaking while the agent talks interrupts it
- [x] The front end only ever receives short-lived tokens, never the real key
- [x] Voice turns produce the same events on the stream as text turns

## Comments

Built and tested without a Gemini key or a mic. Two boxes need a real mic and key, so a person has to check them:

- **A spoken turn gets a spoken reply in real time.** The whole path is built (window mic → LiveKit → core → Gemini Live → core → LiveKit → window). It is tested end to end over a real local LiveKit server with a fake model (`test/livekit-bridge.test.ts`), and the Gemini wire mapping is tested on recorded-shape messages. Real Gemini audio still needs checking.
- **Speaking while the agent talks interrupts it.** Gemini's `interrupted` signal → `interrupted` event + `AudioSource.clearQueue()` is tested over real LiveKit (the test fails if the clear is removed). Real barge-in depends on Gemini's voice detection, so it needs a human check.

How to check: `docs/voice-manual-check.md` (`bun run start`, open the printed `/check` page, talk). Then tick both boxes and set Status to done.

Notes:
- The voice worker runs on Bun inside the core process (`@livekit/rtc-node` works under Bun and in `bun build --compile`). No Node needed.
- The window gets only a 10-minute LiveKit JWT. The core's own Gemini Live session connects with a single-use ephemeral token (v1alpha). The real key stays in the token service.
- LiveKit runs with a random API secret on every launch, not dev mode's well-known `devkey/secret`, and binds to 127.0.0.1 only.
- Known gap: in Ask me mode, a spoken "yes" does not yet approve a waiting tool call. Only a typed yes does (ticket 02's approval path is text-only).
