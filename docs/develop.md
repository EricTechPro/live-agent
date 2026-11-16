# Develop

You need [Bun](https://bun.sh). For the voice from the repo, also `brew install livekit`.

```sh
bun install
bun test               # fast tests, scripted fake model, no network
cp .env.example .env   # add your GEMINI_API_KEY
bun run smoke          # one real text turn against Gemini Live (skips with no key)
bun run start          # the core from source; open the printed /check page to talk
bun run doctor         # the doctor check
bunx tsc --noEmit      # type check (also in app/)
```

`bun run start` reads `tools/` straight from the folder, so a new tool works at once. The
built app is one compiled file, so new tools also go in `src/core/bundled-tools.ts`
(a test reminds you). The voice check by hand: [`docs/voice-manual-check.md`](voice-manual-check.md).

**Build the app** (needs Rust via rustup and Go, for the bundled LiveKit server):

```sh
cd app
bun install
bunx tauri build --debug   # builds the core (bun 1.4.4 --compile), LiveKit and the window
```

Releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml) on a
`v*` tag: build, install-test on a clean Mac with `get.sh`, then publish.

The plan: [`docs/spec.md`](spec.md). Decisions and reasons: [`docs/plan.md`](plan.md)
and [`docs/adr/`](adr). Work is tracked in [`tickets/`](../tickets).
