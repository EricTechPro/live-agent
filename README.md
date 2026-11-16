<div align="center">

<img src="assets/logo.svg" width="112" alt="Jett logo">

<p><strong>Call My Agent.</strong> Your own Jarvis on your Mac. Real-time voice AI with the Gemini Live API and LiveKit.</p>

<!-- DEMO: YouTube link + GIF go here once the video is out -->

<p>Gemini Live · LiveKit on your own computer · one Gemini key · macOS (Apple Silicon)</p>

</div>

**Jett** is a small desktop app you talk to. Built for the DevFest Vancouver 2026 codelab
"Call My Agent: Realtime Voice AI with the Gemini Live API and LiveKit".

## Contents

- [What it is](#what-it-is)
- [Install and get your key](#install-and-get-your-key)
- [Customise it](#customise-it)
- [How it works inside](#how-it-works-inside)
- [Develop](#develop)
- [Learn more](#learn-more)

*What this shows: how your voice gets from your mouth to Gemini and back.*

```text
┌────────────┐      ┌─────────────┐      ┌─────────────┐      ┌────────────────┐      ┌───────────────┐
│ You talk   │ ───► │ App window  │ ───► │ LiveKit     │ ───► │ Agent          │ ───► │ Gemini Live   │
│ your voice │      │ orb + words │      │ on your Mac │      │ safety + tools │      │ hears, speaks │
└────────────┘      └─────────────┘      └─────────────┘      └────────────────┘      └───────────────┘
```

| # | Box | What it does | Tool |
|---|---|---|---|
| 1 | You talk | mic picks up your voice | livekit-client |
| 2 | App window | orb, transcript, job board | Tauri 2 + Vite |
| 3 | LiveKit | carries the voice live, on your Mac | livekit-server |
| 4 | Agent | safety check, then runs the tools | Bun + @livekit/rtc-node |
| 5 | Gemini Live | hears, thinks, speaks | @google/genai |

## What it is

- **Talks back in real time.** One Gemini Live model hears, thinks and speaks; cut in any time.
- **Knows your notes.** Searches your second brain folder and shows which notes it used.
- **Remembers.** "Remember this" saves a note; a background job tidies notes into wiki pages.
- **Sees your screen.** Looks when you ask, and can point at things on it.
- **Draws while it talks.** Sketches boxes, arrows and diagrams on a canvas.
- **Hands off big jobs.** Starts Gemini CLI, Codex or Claude Code in the background.
- **You set what it may do alone.** Three safety modes; <kbd>Shift</kbd>+<kbd>Tab</kbd> switches them.
- **Runs on your Mac.** LiveKit is inside the app. No accounts, just one Gemini key.

Full list: [docs/features.md](docs/features.md).

## Install and get your key

*What this shows: the four steps from nothing to talking.*

```text
┌──────────────┐      ┌────────────┐      ┌──────────────┐      ┌──────────────┐
│ 1. Get a key │ ───► │ 2. Install │ ───► │ 3. Paste key │ ───► │ 4. Talk      │
│ AI Studio    │      │ one line   │      │ in the app   │      │ ask anything │
└──────────────┘      └────────────┘      └──────────────┘      └──────────────┘
```

| # | Step | Tool |
|---|---|---|
| 1 | Get a key | Google AI Studio |
| 2 | Install | `get.sh` one-liner |
| 3 | Paste key | the app window |
| 4 | Talk | **Start talking** button |

macOS on Apple Silicon. In Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/EricTechPro/live-agent/main/get.sh | bash
```

1. Open <https://aistudio.google.com/apikey> and sign in.
2. Press **Create API key** (or use one already in the list) and copy it.
3. Paste it when the installer or the app window asks. It stays in `~/Desktop/live-agent/.env`.
4. Allow the mic, press **Start talking**, and ask "What is my sourdough starter called?"

Keep the key secret. More help: [install](docs/install.md), [Gemini key](docs/gemini-key.md),
[doctor](docs/config.md#doctor).

## Customise it

One file: `~/Desktop/live-agent/live-agent.config.json`. The setup wizard writes it.
Every field is optional; restart the app after a change. For example, ask before anything runs,
but let it save notes freely:

```json
"safety": { "mode": "ask-me", "overrides": { "remember": "allow" } }
```

Every field, the safety modes and helper settings: [docs/config.md](docs/config.md).

## How it works inside

*What this shows: Gemini Live picks a tool, and each tool gives Jett one ability.*

```text
┌──────────┐      ┌──────────────┐        ┌────────────────────────────────┐
│ You ask  │ ───► │ Gemini Live  │ ──┬──► │ Second brain                   │
│ by voice │      │ picks a tool │   │    │ search + remember              │
└──────────┘      └──────────────┘   │    └────────────────────────────────┘
                                     │    ┌────────────────────────────────┐
                                     ├──► │ Files                          │
                                     │    │ read your files                │
                                     │    └────────────────────────────────┘
                                     │    ┌────────────────────────────────┐
                                     ├──► │ Screen                         │
                                     │    │ look + point                   │
                                     │    └────────────────────────────────┘
                                     │    ┌────────────────────────────────┐
                                     ├──► │ Draw                           │
                                     │    │ sketch on a canvas             │
                                     │    └────────────────────────────────┘
                                     │    ┌────────────────────────────────┐
                                     └──► │ Helper agents                  │
                                          │ Codex, Claude Code, Gemini CLI │
                                          └────────────────────────────────┘
```

| # | Ability | Tool files |
|---|---|---|
| 1 | Second brain | [`tools/search-brain.ts`](tools/search-brain.ts), [`tools/remember.ts`](tools/remember.ts) |
| 2 | Files | [`tools/read-file.ts`](tools/read-file.ts) |
| 3 | Screen | [`tools/look.ts`](tools/look.ts), [`find-on-screen.ts`](tools/find-on-screen.ts), [`mark-screen.ts`](tools/mark-screen.ts) |
| 4 | Draw | [`tools/draw.ts`](tools/draw.ts), [`edit-canvas.ts`](tools/edit-canvas.ts) |
| 5 | Helper agents | [`tools/start-helper.ts`](tools/start-helper.ts) → [`src/helpers/`](src/helpers) `codex.ts`, `claude-code.ts`, `gemini-cli.ts` |

One voice turn:

```text
┌────────────────┐      ┌──────────────┐      ┌────────────┐      ┌───────────────┐      ┌────────────┐
│ 1. You ask     │ ───► │ 2. Gemini    │ ───► │ 3. Safety  │ ───► │ 4. Tool runs  │ ───► │ 5. Speaks  │
│ "Sum up notes" │      │ picks a tool │      │ check: OK? │      │ still talking │      │ the answer │
└────────────────┘      └──────────────┘      └────────────┘      └───────────────┘      └────────────┘
```

Four small ideas make it work:

| # | Idea | What it does | Tool |
|---|---|---|---|
| 1 | One voice model | hears, thinks and speaks over one WebSocket | Gemini Live |
| 2 | Local voice pipe | real-time audio on `127.0.0.1` | LiveKit (WebRTC) |
| 3 | Non-blocking tools | it keeps talking while a tool runs | `NON_BLOCKING` |
| 4 | Ephemeral tokens | the window never sees your key | single-use token |

The full story and where to start reading the code: [docs/how-it-works.md](docs/how-it-works.md).

## Develop

You need [Bun](https://bun.sh). For voice from the repo, also `brew install livekit`.

```sh
bun install
bun test               # fast tests, scripted fake model, no network
cp .env.example .env   # add your GEMINI_API_KEY
bun run start          # the core from source
```

Smoke test, doctor, type check and building the app: [docs/develop.md](docs/develop.md).

## Learn more

- [DevFest codelab](docs/codelab.md): the one-hour run order for the room, and the kit to copy.
- [Live site](https://erictechpro.github.io/live-agent/): erictechpro.github.io/live-agent.
- [Second brain](docs/second-brain.md) and [helper agents](docs/helpers.md): how notes and jobs work.
- [`prompts/`](prompts/README.md): the real prompts the agent sends to Gemini.
- [`skills/`](skills/README.md): skills for coding agents, like adding a tool or bringing your own brain.
- [`sample-brain/`](sample-brain/README.md): the shape of a brain.
- The plan: [`docs/spec.md`](docs/spec.md). Decisions: [`docs/plan.md`](docs/plan.md) and [`docs/adr/`](docs/adr). Work: [`tickets/`](tickets).
