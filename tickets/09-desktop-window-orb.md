# 09: Desktop window: orb, transcript, talk out loud

**What to build:** A Tauri desktop app opens a window with a voice orb on the left that shows listening, thinking and speaking, plus a live transcript. The app asks for mic access with a clear reason. The window only renders events from the agent core; no agent logic lives in it. Stays light on RAM.

**Blocked by:** 08 Voice over local LiveKit with ephemeral tokens

**Status:** done

**Priority:** must-have

- [x] Opening the app shows the orb and transcript
- [x] The orb state follows listening, thinking and speaking events
- [x] First launch asks for mic access with a plain reason
- [x] Talking in the window works end to end over local LiveKit
- [x] Idle RAM use is measured and written in the ticket's PR

## Comments

**Built (agent, 2026-11-14).** `app/` is the Tauri v2 shell (plain TS + Vite, `livekit-client` 2.24.1).
Rust starts the core as a sidecar (`externalBin: binaries/live-agent-core`), reads its one `ready`
line, hands url + launch token to the window through the `core_status` command, and stops the core
on quit (SIGTERM, then kill after 2 s). The core also stops itself if the app dies hard
(`LIVE_AGENT_EXIT_WITH_PARENT`; checked: `kill -9` on the app left no core or LiveKit behind).
The window only renders events: `app/src/orb-state.ts` and `app/src/transcript.ts` are pure and
unit-tested (`test/orb-state.test.ts`, `test/transcript-view.test.ts`).
The compiled core can't read `tools/` at run time, so it ships `src/core/bundled-tools.ts`;
`test/bundled-tools.test.ts` fails if a tool file is missing from that list.

Build: `cd app && bun install && bunx tauri build --debug` (Rust on PATH: `~/.cargo/bin`).
`beforeBuildCommand` runs `scripts/build-core.sh`: `npx bun@1.4.4 build --compile` + `codesign -v` (passes;
the bundled `Contents/MacOS/live-agent-core` also passes `codesign -v`). Info.plist in the bundle has
`NSMicrophoneUsageDescription`.

Checked by the agent: the debug .app launches, starts the core and LiveKit, and the webview connects to
the core's `/events` stream. A typed turn through real Gemini rendered in the window UI
(same build, in a browser with the Tauri call stubbed, because screen capture is not allowed here):
orb went thinking -> speaking -> listening, transcript showed both lines.

**Idle RAM** (debug build, ~40 s idle after launch, not talking, macOS physical footprint):

| process | footprint |
|---|---|
| live-agent (Tauri) | 32 MB |
| WebKit WebContent + GPU + Networking | 27 + 17 + 6.5 MB |
| live-agent-core (Bun sidecar) | 43 MB |
| livekit-server | 24 MB |
| **total** | **~150 MB** (sum of RSS ~330 MB, which double counts shared pages) |

**Needs a person** (mic prompt and real talking can't be done by an agent):
1. `cd app && bunx tauri build --debug`, then `tccutil reset Microphone dev.liveagent.app`.
2. Start it from a terminal so it gets the key and PATH (livekit-server from brew):
   `set -a; . ../.env; set +a; open src-tauri/target/debug/bundle/macos/live-agent.app`
   (or run `.../live-agent.app/Contents/MacOS/live-agent` directly).
3. The orb shows "Listening" and the type box is enabled. Press **Start talking**.
   macOS should ask for the mic with: "live-agent listens to your voice so you can talk to it.
   Your voice goes to Gemini only while you are talking." Allow it. Tick box 3.
4. With headphones, ask something. Your words show as "you", the orb goes thinking after you pause,
   then speaking while the agent's voice plays, then listening. Talk over it: it stops and shows
   "(interrupted)". Tick box 4, set Status to done.
5. If `getUserMedia` fails with NotAllowedError despite allowing it, see the 09 research notes (WKWebView media capture).

Known gaps for later tickets: opened from Finder the app has no API key and no `livekit-server` on PATH
(ticket 13 bundles LiveKit and settles key storage). Running from the repo writes chat-end notes into
`sample-brain/raw/` (the default brain path); don't commit those.

Manual check by Eric, 2026-11-14 (debug build at 10d1b10+, launched with `open --env`): the macOS mic prompt showed with the plain reason, a spoken question ("What's my sourdough starter called?") got a spoken answer ("Gus") in real time, and talking over the agent interrupted it.
