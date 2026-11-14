# 09: Desktop window: orb, transcript, talk out loud

**What to build:** A Tauri desktop app opens a window with a voice orb on the left that shows listening, thinking and speaking, plus a live transcript. The app asks for mic access with a clear reason. The window only renders events from the agent core; no agent logic lives in it. Stays light on RAM.

**Blocked by:** 08 Voice over local LiveKit with ephemeral tokens

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Opening the app shows the orb and transcript
- [ ] The orb state follows listening, thinking and speaking events
- [ ] First launch asks for mic access with a plain reason
- [ ] Talking in the window works end to end over local LiveKit
- [ ] Idle RAM use is measured and written in the ticket's PR
