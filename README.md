<p align="center"><img src="assets/logo.svg" width="128" alt="live-agent logo"></p>

<h1 align="center">live-agent</h1>

Talk to your own AI. It hears you, talks back in real time, knows your notes, and hands big jobs to helper agents.

Built with the Gemini Live API and LiveKit. Made for the DevFest Vancouver 2026 codelab "Call My Agent".

> Work in progress. See `docs/spec.md` for the plan.

## Install (macOS, Apple Silicon)

```sh
curl -fsSL https://raw.githubusercontent.com/EricTechPro/live-agent/main/get.sh | bash
```

It downloads the ready-built app (no Rust needed) into `/Applications` (or `~/Applications`),
makes a `live-agent` folder on your Desktop with the sample brain, asks for your Gemini key,
runs `live-agent doctor`, and opens the app into the setup chat.

Your Desktop folder `~/Desktop/live-agent`:

| file | what it is |
|---|---|
| `sample-brain/` | the brain the app reads and writes (`raw`, `wiki`, `projects`) |
| `live-agent.config.json` | your settings, written by the setup chat |
| `.env` | your Gemini key (`GEMINI_API_KEY=...`), readable only by you |

Run the same command again to upgrade. It never touches your brain, config or key.
The app is not notarized; `curl` downloads don't get the quarantine flag, so macOS opens it.
After an upgrade macOS may ask for the mic again (each build has a new ad-hoc signature).

## Develop

```sh
bun install
bun test          # fast tests, scripted fake model, no network
cp .env.example .env   # add your GEMINI_API_KEY
bun run smoke     # one real text turn against Gemini Live (skips with no key)
```
