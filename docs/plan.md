# live-agent: plan from grilling (2026-11-13)

Talk: "Call My Agent: Realtime Voice AI with the Gemini Live API and LiveKit"
DevFest Vancouver, Fri Nov 27 2026, ~1 hour.

## Decisions

- Name: `live-agent` (repo and Desktop folder).
- Install: one command, like super-board `get.sh`. Drops `~/Desktop/live-agent`.
- README: as easy as super-board. Clear "get your Gemini key" guide.
- Target user: one person at home. Room logistics come second.
- Keys: only a Gemini key on day one. LiveKit runs locally (`livekit-server --dev`, keys devkey/secret). LiveKit Cloud only for phone calls later.
- App: Tauri desktop app. Must stay light on RAM.
- Main window: voice orb left, helper job board right, bottom bar shows brain notes used + safety mode.
- Mini mode: shrinks to a floating always-on-top orb (Roamies idea). Roamies is AGPL: borrow ideas, not code.
- Brain: sample folder shipped in repo with `raw`, `wiki`, `projects`. Real brain never committed.
- Learning (must-have): at end of each chat, save one note to `raw`. A background helper tidies `raw` into `wiki` (Karpathy style). Voice never waits. Shows on job board.
- Tools: a `tools` folder. NON_BLOCKING calls.
- Helpers: Gemini Live is the boss. It sends jobs to helper agents (Gemini CLI, Codex, Claude Code).
- Config: one JSON file. Helpers on/off, max at once, worktrees on/off, per-tool settings, safety mode.
- First run: setup chat asks questions and writes the JSON (like super-board setup).
- Safety: 3 modes like Claude Code. Ask me / Auto edits / Bypass. Shift+Tab cycles, plus dropdown. Default: Auto edits.
- Ship the kit: prompts and skills in the repo, ready to copy.

## Codelab flow (demo first, inside last)

1. Live demo (5)
2. Setup: keys, install (15)
3. Customise: JSON, modes (10)
4. Build your brain (10)
5. Connect tools + real uses (10)
6. How Gemini Live + LiveKit work inside (10)

Demo backup: launch a YouTube showcase video first (Roamies style). Play it if live fails.

## 3 weakest spots

1. Setup in the room. Tauri needs Rust and slow first builds. Mac asks for mic permission. 100 people on venue wifi.
   Fix: ship a ready-built app (.dmg / .exe) on GitHub Releases, so nobody builds Rust. Bundle livekit-server. Add a `live-agent doctor` check (key, mic, LiveKit up). Post the link 2 days early.
2. Too much to build by Nov 27 (14 days).
   Fix: Nov 27 must-haves: voice, brain read, raw save + tidy, one helper, 3 modes. After the talk: worktrees, many helpers at once, mini orb.
3. Helpers need CLIs installed and signed in. Most people won't have Codex or Claude Code. Many helpers also eat RAM.
   Fix: default helper is Gemini CLI (free Google sign-in, fits DevFest). Max 1 helper at a time by default. Codex and Claude Code opt-in in the JSON.
