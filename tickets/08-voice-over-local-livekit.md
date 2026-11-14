# 08: Voice over local LiveKit with ephemeral tokens

**What to build:** The user talks and hears the agent in real time. Audio travels over a LiveKit server that runs on the user's own machine (dev mode, bundled), so no LiveKit account is needed. A local token service mints ephemeral Gemini and LiveKit tokens; the real Gemini key never reaches the front end. The user can interrupt the agent mid-sentence.

**Blocked by:** 01 Text turn through the agent core

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Starting live-agent starts the local LiveKit server and stops it on exit
- [ ] A spoken turn gets a spoken reply in real time
- [ ] Speaking while the agent talks interrupts it
- [ ] The front end only ever receives short-lived tokens, never the real key
- [ ] Voice turns produce the same events on the stream as text turns
