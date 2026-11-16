# How it works inside

Short version with diagrams: [README](../README.md#how-it-works-inside).

Four ideas make it work. Each one is small.

```
 ┌──────────────────────────── your Mac ─────────────────────────────┐
 │                                                                   │
 │  window (Tauri)          LiveKit server         agent core (Bun)  │
 │  orb, transcript,  mic   local, 127.0.0.1  mic  voice worker      │
 │  job board      ◄──────► one room       ◄─────► safety gate       │
 │      │          voice                   voice   tools/, brain     │
 │      │                                          helper jobs       │
 │      └──── events: transcript, jobs, notes used ◄───┤             │
 │                                                     │             │
 └─────────────────────────────────────────────────────┼─────────────┘
                                                       │ WebSocket: voice in/out,
                                    single-use token   │ tool calls and results
                                                       ▼
                                              Gemini Live (Google)
```

## Gemini Live: one model hears, thinks and speaks

Older voice bots chain three models: speech-to-text, a chat model, text-to-speech. Each hop
adds delay. Gemini Live (`gemini-3.8-live`) does all three in one. The core keeps one
WebSocket open to it, streams your voice in as small audio chunks, and gets its voice back as
audio chunks while it is still thinking of the rest. Gemini also listens for when you stop
talking, and if you talk over it, it sends an "interrupted" signal; the core then drops the
audio it had queued, so it goes quiet at once.

## LiveKit: the pipe for your voice

Audio in real time is hard: echo, jitter, lost packets, mic devices. LiveKit is an open-source
server that solves that with WebRTC, the same tech as video calls. live-agent bundles the
LiveKit server inside the app and starts it on your own computer (only on `127.0.0.1`, with a
fresh secret every launch). The window joins a LiveKit "room" with your mic. The core joins the
same room as the voice worker: it passes your audio to Gemini Live and plays Gemini's voice back
into the room. No LiveKit account, nothing in the cloud but Gemini itself.

## NON_BLOCKING tools: it keeps talking while tools run

A normal tool call makes the model stop and wait. That is fine in a chat window, but in a voice
call it means awkward silence. Every live-agent tool is declared `NON_BLOCKING`: Gemini calls it
and keeps talking ("let me check your notes..."). When the result comes back, the core hands it
over with a scheduling hint: `WHEN_IDLE` means "say this when you finish your sentence",
`SILENT` means "just know it". Long work goes one step further: `start_helper` answers at once
with a job id, and when the job ends minutes later the core sends Gemini one more result for the
same call, so the voice tells you it is done.

Every tool call also passes the **safety gate** first: one small function that looks at the
tool's risk class and your mode and says allow, ask or block (see [Safety modes](config.md#safety-modes)).

## Ephemeral tokens: the real key stays put

Your Gemini key is a password; anything that holds it can spend your quota. So it lives in one
place: `~/Desktop/live-agent/.env`, read only by the agent core. Before each Live session the
core's token service trades the key for an **ephemeral token**: good for one session, that must
start within a minute and dies within 30 minutes. The Live connection uses that token, not the
key. The window never sees either: it only gets a 10-minute LiveKit token for the room, and a
per-launch token for the core's local event stream. Even if the window leaked, there is no key
in it. (One exception, on purpose: if you skipped the key at install, you paste it into the
window once. It goes straight to the core, which saves it to `.env`; the window keeps no copy.
See [ADR 0002](adr/0002-paste-key-in-the-window.md).)

Want to read the code? Start at [`src/core/agent.ts`](../src/core/agent.ts) (the core),
[`src/models/gemini-live.ts`](../src/models/gemini-live.ts) (Gemini Live and NON_BLOCKING),
[`src/voice/livekit-bridge.ts`](../src/voice/livekit-bridge.ts) (LiveKit) and
[`src/voice/token-service.ts`](../src/voice/token-service.ts) (ephemeral tokens).

## The whole thing, with real names

```text
┌───────────────────────┐      ┌───────────────────────┐      ┌────────────────────┐      ┌──────────────────┐
│ Tauri 2 window        │ ───► │ livekit-server        │ ───► │ Agent core (Bun)   │ ───► │ Gemini Live      │
│ Vite + TS             │      │ 127.0.0.1:7880        │      │ @livekit/rtc-node  │      │ @google/genai    │
│ livekit-client mic    │      │ started by Bun.spawn  │      │ safety gate, tools │      │ single-use token │
│ orb, transcript, jobs │      │ fresh secret a launch │      │ brain, helper jobs │      │ gemini-3.8-live  │
└───────────────────────┘      └───────────────────────┘      └────────────────────┘      └──────────────────┘
```

The window sends WebRTC audio to the LiveKit server; the agent core joins the same room through a
bridge on `@livekit/rtc-node` (not LiveKit Agents) and talks to Gemini Live over one WebSocket,
voice and tool calls both ways. Events (transcript, jobs, notes used) go back to the window over
HTTP and Server-Sent Events on `/events`.

| # | Box | Code |
|---|---|---|
| 1 | Window and mic | [`app/src/main.ts`](../app/src/main.ts) |
| 2 | LiveKit server | [`src/voice/livekit-runner.ts`](../src/voice/livekit-runner.ts) |
| 3 | Agent bridge | [`src/voice/livekit-bridge.ts`](../src/voice/livekit-bridge.ts) |
| 3a | Safety check | [`src/core/safety.ts`](../src/core/safety.ts) |
| 4 | Gemini Live | [`src/models/gemini-live.ts`](../src/models/gemini-live.ts) |
