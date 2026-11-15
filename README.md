<div align="center">

<img src="assets/logo.svg" width="112" alt="live-agent logo">

<h1>live-agent</h1>

<p><strong>Talk to your own AI. It hears you, talks back in real time, knows your notes, and hands big jobs to helper agents.</strong></p>

<p>Gemini Live · LiveKit on your own computer · one Gemini key · macOS (Apple Silicon)</p>

<p><a href="#install">Install</a> · <a href="#get-your-gemini-key">Get your Gemini key</a> · <a href="#customise-it">Customise</a> · <a href="#your-second-brain">Brain</a> · <a href="#helper-agents">Helpers</a> · <a href="#how-it-works-inside">How it works inside</a> · <a href="#devfest-codelab">Codelab</a></p>

</div>

Made for the DevFest Vancouver 2026 codelab "Call My Agent". Take it home: the app, the
[prompts](prompts/README.md) and the [skills](skills/README.md) are all in this repo, ready to copy.

## What it is

A small desktop app you talk to.

- **It talks back in real time.** Gemini Live hears, thinks and speaks in one model. You can
  interrupt it mid-sentence.
- **It knows your notes.** It reads a **second brain** folder (`raw`, `wiki`, `projects`) and
  shows which notes each answer used. It ships with a made-up sample brain so it works on day one.
- **It learns slowly.** After a chat it saves a short note, and a background job tidies new
  notes into clean wiki pages.
- **It hands off big jobs.** "Fix the bug in my recipe app" starts a **helper agent**
  (Gemini CLI, Codex or Claude Code) in the background. A job board shows its progress, and
  the voice tells you when it is done. It never freezes while a tool runs. With worktrees on,
  a finished job's changes are committed on its own branch for you to review.
- **It draws.** "Draw how the voice gets to Gemini" sketches on the Canvas tab while the
  voice talks: hand-drawn boxes, arrows and Mermaid diagram cards, each beat's strokes timed
  to the line being said (`draw`). "Make p2 red" or "clear the board" changes it (`edit_canvas`).
- **It shrinks out of the way.** The **Mini** button turns the window into a small
  always-on-top orb that shows how many jobs are running. Voice keeps working; click the orb
  to open the full window again.
- **You decide what it may do alone.** Three safety modes, Ask me / Auto edits / Bypass.
  <kbd>Shift</kbd>+<kbd>Tab</kbd> switches them.
- **One JSON file controls it all**, and a click-through setup wizard fills it in for you.

All you need is a Gemini key. LiveKit (the part that carries your voice) runs on your own
computer, inside the app. No accounts, no cloud servers.

## Install

macOS on Apple Silicon. In Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/EricTechPro/live-agent/main/get.sh | bash
```

Have your Gemini key ready (next section): the installer asks for it. It then:

1. downloads the ready-built app (no Rust, no build) into `/Applications` (or `~/Applications`),
2. makes a `live-agent` folder on your Desktop with the sample brain,
3. saves your key in that folder, readable only by you,
4. runs the doctor check (key, microphone, LiveKit, helper CLIs),
5. opens the app, which starts the **setup wizard**.

Your Desktop folder `~/Desktop/live-agent`:

| file | what it is |
|---|---|
| `sample-brain/` | the brain the app reads and writes (`raw`, `wiki`, `projects`) |
| `live-agent.config.json` | your settings, written by the setup wizard |
| `.env` | your Gemini key (`GEMINI_API_KEY=...`), readable only by you |

Then:

1. **Allow the microphone** when macOS asks. The reason it shows: "live-agent listens to your
   voice so you can talk to it."
2. **Click through the setup wizard.** Jett's voice, your Gemini key (if not saved yet), the
   mic, your notes folder (sample notes, or your own folder: it maps your folders onto raw,
   wiki and projects), how Jett talks (Short, Casual, Friendly, Professional) and how careful
   it is. Then say hi to test the voice. It saves `live-agent.config.json`, and the new
   settings are in use straight away.
3. **Press Start talking** and say "What is my sourdough starter called?" It answers from
   the sample brain, and the bottom bar shows `Notes used wiki/sourdough-starter.md`.
   Use headphones so it doesn't hear itself.

Run the same command again to upgrade. It never touches your brain, config or key.
The app is not notarized; `curl` downloads don't get the quarantine flag, so macOS opens it.
After an upgrade macOS may ask for the mic again (each build has a new signature).

## Get your Gemini key

The key is how Google knows the requests are yours. One key runs everything: the voice, the
tidy job and the Gemini CLI helper. It takes about two minutes.

1. **Open Google AI Studio.** Go to <https://aistudio.google.com/apikey> and sign in with your
   Google account.

   <img src="docs/images/key-guide/01-open-ai-studio.png" width="640" alt="Google AI Studio sign-in page at aistudio.google.com/apikey">

2. **Accept the terms** (first visit only). Tick the box to agree to the Gemini API terms and
   press **Continue**.

   <img src="docs/images/key-guide/02-accept-terms.png" width="640" alt="The Gemini API terms dialog with the agree box and Continue button">

3. **Find the API keys page.** You land on **API keys**. New accounts often already have one
   key in a default project. If you see a key in the list, skip to step 5.

   <img src="docs/images/key-guide/03-api-keys-page.png" width="640" alt="The API keys page with the Create API key button at the top right">

4. **Create a key.** Press **Create API key**. In the dialog, give the key a name (for example
   `live-agent`), pick a project or press **Create project**, then press **Create key**.

   <img src="docs/images/key-guide/04-create-key-dialog.png" width="640" alt="The Create API key dialog: key name, project picker, Create key button">

5. **Copy the key.** Click the key in the list, then press **Copy**. It is a long string that
   starts with `AQ.` (new auth keys, the default since May 2026) or `AIza` (older keys). Both work.

   <img src="docs/images/key-guide/05-copy-key.png" width="640" alt="The key details with the Copy button">

6. **Paste it into the installer.** When the installer says `Paste your Gemini key`, paste
   and press <kbd>Enter</kbd>. Nothing shows while you paste; that is on purpose.

   <img src="docs/images/key-guide/06-paste-in-installer.png" width="640" alt="Terminal: the installer asking to paste the Gemini key">

**Skipped it?** No problem: the app opens on **Paste your Gemini key**. Paste it there and press
**Save and start**. The app checks the key with Google, saves it in `~/Desktop/live-agent/.env`
(readable only by you) and goes straight into the setup wizard. The window never shows it again.

**Got a new key?** Open the key file and put the key after `GEMINI_API_KEY=`:

```sh
open -e ~/Desktop/live-agent/.env      # GEMINI_API_KEY=AQ.... (or AIza...)
```

Then quit and reopen the app. Check it with the [doctor](#doctor): `✓ Gemini key: key works`.

Keep the key secret: never paste it into a chat, a screenshot or a git repo. If it leaks,
delete it on the same page and make a new one. The free tier is enough to try live-agent;
Google may ask you to turn on billing for heavier use.

## Customise it

Everything lives in one file: `~/Desktop/live-agent/live-agent.config.json`. The setup wizard
writes it (press **Setup** in the window to run it again), and you can edit it by hand.
Every field is optional; a missing field uses the default. Restart the app after a change.

This is the whole file with every default:

```json
{
  "brainPath": "sample-brain",
  "safety": {
    "mode": "auto-edits",
    "overrides": {}
  },
  "helpers": {
    "geminiCli": true,
    "codex": false,
    "claudeCode": false,
    "maxAtOnce": 1
  },
  "worktrees": false,
  "voice": "Puck"
}
```

| field | what it does | default |
|---|---|---|
| `brainPath` | the brain folder. A relative path starts in `~/Desktop/live-agent`. By hand, write a full path (`/Users/you/notes`); the setup wizard picks it in Finder. Setup refuses a folder that does not exist. | `sample-brain` |
| `brainFolders` | which folder inside the brain plays each part: `{ "raw": "_inbox", "wiki": "03 Notes", "projects": "work" }`. A name or a relative path; never outside the brain. The wizard detects them by name. | `raw`, `wiki`, `projects` |
| `tone` | how Jett talks: `short` (answer first, few plain words, one idea per line), `casual`, `friendly` or `pro` | `short` |
| `safety.mode` | what runs without asking: `ask-me`, `auto-edits` or `bypass` (table below) | `auto-edits` |
| `safety.overrides` | per-tool verdicts that win over the mode: `allow`, `ask` or `block` | `{}` |
| `helpers.geminiCli` | allow the Gemini CLI helper | `true` |
| `helpers.codex` | allow Codex as a helper (needs your own Codex sign-in) | `false` |
| `helpers.claudeCode` | allow Claude Code as a helper (needs your own Claude Code sign-in) | `false` |
| `helpers.maxAtOnce` | most helper jobs running at once; extra jobs wait in the queue | `1` |
| `worktrees` | give each helper job its own git worktree and branch, so it never touches your checkout ([Worktrees](#worktrees)) | `false` |
| `voice` | Gemini Live voice name, e.g. `Puck`, `Kore`, `Charon` (not wired yet: today it always uses Gemini's default voice) | `Puck` |

The full rules are in [`src/config/config.schema.json`](src/config/config.schema.json). Point your
editor at it with `"$schema"` for autocomplete. A bad value stops the app with a message that
names the field.

### Safety modes

Every tool has a **risk class**. The mode decides what each class may do:

| risk class | example tools | Ask me | Auto edits | Bypass |
|---|---|---|---|---|
| read | `search_brain`, `read_file`, `draw`, `edit_canvas` | runs | runs | runs |
| edit | `remember`, `cancel_job` | asks | runs | runs |
| command | (shell commands) | asks | asks | runs |
| helper | `start_helper` | asks | asks | runs |

"Asks" means the agent asks you first and waits for your yes. Today the yes has to be typed
in the window; a spoken yes is still on the to-do list. A blocked or declined call is
explained in the agent's own voice, and every verdict shows in the window.

Switch modes with <kbd>Shift</kbd>+<kbd>Tab</kbd> (Ask me → Auto edits → Bypass) or the
dropdown in the bottom bar. That change lasts until the app quits; the file sets the mode
it starts in.

### Per-tool overrides

An override beats the table. Use it to loosen one tool or lock one down:

```json
"safety": {
  "mode": "ask-me",
  "overrides": {
    "remember": "allow",
    "start_helper": "block"
  }
}
```

Here "remember this" saves at once even in Ask me, and helpers can never start.

### Helpers

`helpers.geminiCli`, `helpers.codex` and `helpers.claudeCode` let the agent start jobs with
that helper; turning one on is what allows it. `maxAtOnce` keeps your laptop
cool: with `1`, a second job waits until the first is done. See [Helper agents](#helper-agents).

## Your second brain

A brain is a plain folder of markdown files with three parts:

| folder | what goes in | used for |
|---|---|---|
| `raw/` | quick, messy notes: chat-end notes, "remember this" notes | the tidy job's input |
| `wiki/` | one clean page per topic (a person, a thing, a plan) | answers |
| `projects/` | one page per project: goal, status, next steps | answers |

How it flows:

- **Answers.** When you ask about your own life, Gemini calls `search_brain`, which searches
  `wiki/` and `projects/`. The bottom bar shows **Notes used** for that answer.
- **Chat-end note.** When a chat ends, the agent writes a two-to-five-bullet summary of it into
  `raw/` (for example `raw/2026-11-14-chat.md`). Nothing you said is lost.
- **"Remember this."** Say "remember that the gate code is 4512" and the `remember` tool writes
  a raw note right away.
- **Tidy.** A background job reads new raw notes and folds them into `wiki/` pages,
  Karpathy-style: update a page when the topic exists, make a new one when it doesn't, never
  invent facts. It only ever writes inside `wiki/`, and it shows on the job board. The prompt
  it uses is [`prompts/tidy.md`](prompts/tidy.md). A chat ends (note saved, tidy queued)
  when you press **New chat**, after ten quiet minutes, or when the app quits.

Use your own notes: the [`bring-your-brain`](skills/bring-your-brain/SKILL.md) skill walks
through it. In short, make `raw/`, `wiki/` and `projects/` in a folder, then set `brainPath`.
Keep your real brain out of any public repo; this repo only ships the made-up sample.

## Helper agents

Gemini Live is the boss. It talks; helpers do the slow work.

- **Start one by asking.** "Fix the off-by-one bug in ~/code/recipe-box." Gemini calls
  `start_helper`, which starts a helper in that folder in the background and answers at
  once with a job id. The voice keeps talking with you.
- **Pick the helper.** Three helpers, each turned on in the config: **Gemini CLI**, **Codex**
  and **Claude Code**. Say "use Claude Code to..." to pick one. If you don't say, the first one
  turned on is used, in that order. Naming one that is turned off, not installed or not signed
  in gets a plain fix instead of a job.
- **Gemini CLI runs on your key.** It uses the same Gemini key as the voice, with its own
  private Gemini CLI settings folder, so your own `gemini` login and settings are never touched.
  (Google ended Gemini CLI's free "Login with Google" tier, so the key is the way in.)
  Install Gemini CLI once: `npm install -g @google/gemini-cli`.
- **Codex and Claude Code run on your own sign-in** with OpenAI and Anthropic, and use your
  plan or API credit. live-agent never signs in for you and never hands them your Gemini key.
  - Codex: `npm install -g @openai/codex`, then `codex login` once. Runs
    `codex exec --json --sandbox workspace-write`: it edits files and runs commands inside the
    folder only. It uses the model in your `~/.codex/config.toml`; if your account can't use
    that model, the job fails saying so.
  - Claude Code: `npm install -g @anthropic-ai/claude-code`, then `claude auth login` once.
    Runs `claude -p --output-format json --permission-mode bypassPermissions`
    (nobody is there to answer its permission prompts) and does not save the run to your
    session list.
- **Max at once.** `helpers.maxAtOnce` jobs run at a time. More jobs wait as **Waiting**.
- **Follow along.** The job board shows each job as Waiting, Working, Done, Failed or Cancelled.
  When a job ends, the agent says how it went.
- **Cancel.** Press **Cancel** on the job, or say "stop job 1" (the `cancel_job` tool).
- **Safety.** Helpers are the `helper` risk class: in Ask me and Auto edits the agent asks
  first. Once started, a helper does not ask again (Gemini CLI "yolo", Codex's workspace
  sandbox, Claude Code's bypass mode), so only point it at code you are happy for it to change.
  Turn on [worktrees](#worktrees) and it works on its own branch instead.
- **Cancel stops everything it started.** Each helper runs in its own process group, and the
  group is stopped on cancel, on quit, or if the core crashes.

### Worktrees

Set `"worktrees": true` in `live-agent.config.json` and each helper job works in its own
git worktree on a new branch, so your current branch, files and uncommitted work are never
touched.

- **Branch:** `live-agent/<task>-<date-time>`, made from your current commit (uncommitted
  changes are not copied in).
- **Where:** `~/Library/Application Support/live-agent/worktrees/<project>/<branch leaf>`
  (Linux: `~/.local/share/live-agent/worktrees/...`), outside your project. The job board
  shows the branch and path, and the agent says the branch when it announces the job.
- **When done:** the helper's changes are committed on that branch. Review and merge from
  your project: `git diff main...live-agent/<...>`, then `git merge live-agent/<...>`.
  A failed or cancelled job commits nothing; its changes stay in the worktree.
- **Clean up:** worktrees are kept for you to review. Remove one with
  `git worktree remove <path>` and `git branch -D <branch>` in your project
  (`git worktree list` shows them all).
- **Not a git project?** The agent says so and starts nothing. Run `git init` and make a
  first commit there, or turn worktrees off.

## Doctor

The doctor checks everything a new user needs and prints one plain fix per problem.
The installer runs it for you. To run it again:

```sh
LIVE_AGENT_HOME=~/Desktop/live-agent /Applications/live-agent.app/Contents/MacOS/live-agent-core doctor
```

(From the repo: `bun run doctor`.)

```
live-agent doctor

✓ Gemini key: key works, gemini-3.8-live is available
✓ Microphone: default input: Bose QC Headphones
✓ LiveKit: local server starts (port 52689)
✓ Gemini CLI: installed, uses your Gemini key
✓ Codex: installed and signed in (turned off)
! Claude Code: installed, not signed in (turned off)
    Fix: Claude Code is not signed in. Run "claude auth login" once in a terminal.

All required checks pass, 1 warning(s).
```

The key, the microphone and LiveKit must pass. A helper CLI only fails when it is turned on in
the config; otherwise a missing or signed-out one is a warning with the fix. Codex and Claude
Code are asked with their own `codex login status` and `claude auth status` (no model call).
A bad key points you back to [Get your Gemini key](#get-your-gemini-key).

The installed app and its doctor only use the key in `~/Desktop/live-agent/.env` (or one you set in
the environment), never a `.env` in the folder you happen to run them from.

**The log.** Opened from Finder, the app keeps what its core says in
`~/Desktop/live-agent/logs/core.log` (small: old lines are dropped). The key and every token are
hidden in it. The **Show log** button in the window shows the file in Finder.

## How it works inside

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

### Gemini Live: one model hears, thinks and speaks

Older voice bots chain three models: speech-to-text, a chat model, text-to-speech. Each hop
adds delay. Gemini Live (`gemini-3.8-live`) does all three in one. The core keeps one
WebSocket open to it, streams your voice in as small audio chunks, and gets its voice back as
audio chunks while it is still thinking of the rest. Gemini also listens for when you stop
talking, and if you talk over it, it sends an "interrupted" signal; the core then drops the
audio it had queued, so it goes quiet at once.

### LiveKit: the pipe for your voice

Audio in real time is hard: echo, jitter, lost packets, mic devices. LiveKit is an open-source
server that solves that with WebRTC, the same tech as video calls. live-agent bundles the
LiveKit server inside the app and starts it on your own computer (only on `127.0.0.1`, with a
fresh secret every launch). The window joins a LiveKit "room" with your mic. The core joins the
same room as the voice worker: it passes your audio to Gemini Live and plays Gemini's voice back
into the room. No LiveKit account, nothing in the cloud but Gemini itself.

### NON_BLOCKING tools: it keeps talking while tools run

A normal tool call makes the model stop and wait. That is fine in a chat window, but in a voice
call it means awkward silence. Every live-agent tool is declared `NON_BLOCKING`: Gemini calls it
and keeps talking ("let me check your notes..."). When the result comes back, the core hands it
over with a scheduling hint: `WHEN_IDLE` means "say this when you finish your sentence",
`SILENT` means "just know it". Long work goes one step further: `start_helper` answers at once
with a job id, and when the job ends minutes later the core sends Gemini one more result for the
same call, so the voice tells you it is done.

Every tool call also passes the **safety gate** first: one small function that looks at the
tool's risk class and your mode and says allow, ask or block (see [Safety modes](#safety-modes)).

### Ephemeral tokens: the real key stays put

Your Gemini key is a password; anything that holds it can spend your quota. So it lives in one
place: `~/Desktop/live-agent/.env`, read only by the agent core. Before each Live session the
core's token service trades the key for an **ephemeral token**: good for one session, that must
start within a minute and dies within 30 minutes. The Live connection uses that token, not the
key. The window never sees either: it only gets a 10-minute LiveKit token for the room, and a
per-launch token for the core's local event stream. Even if the window leaked, there is no key
in it. (One exception, on purpose: if you skipped the key at install, you paste it into the
window once. It goes straight to the core, which saves it to `.env`; the window keeps no copy.
See [ADR 0002](docs/adr/0002-paste-key-in-the-window.md).)

Want to read the code? Start at [`src/core/agent.ts`](src/core/agent.ts) (the core),
[`src/models/gemini-live.ts`](src/models/gemini-live.ts) (Gemini Live and NON_BLOCKING),
[`src/voice/livekit-bridge.ts`](src/voice/livekit-bridge.ts) (LiveKit) and
[`src/voice/token-service.ts`](src/voice/token-service.ts) (ephemeral tokens).

## DevFest codelab

The order for the room. Demo first, inside last. About an hour.

1. **Live demo (5 min).** Watch it talk, answer from the sample brain, take a "remember this",
   and start a helper while it keeps talking.
2. **Setup (15 min).** [Get your Gemini key](#get-your-gemini-key), run the one-line
   [install](#install), let the doctor pass, click through the setup wizard, then say hello.
3. **Customise (10 min).** Open `live-agent.config.json`. Try each [safety mode](#safety-modes)
   with <kbd>Shift</kbd>+<kbd>Tab</kbd>, add a [per-tool override](#per-tool-overrides), restart.
4. **Build your brain (10 min).** Add a page to `wiki/` and a project to `projects/`, ask about
   them, watch **Notes used**. Say "remember this", then find the note in `raw/`. Or point
   `brainPath` at your own notes ([bring-your-brain](skills/bring-your-brain/SKILL.md)).
5. **Connect tools and real uses (10 min).** Ask it to read a file, start a Gemini CLI helper
   on a small project, cancel a job. Then add your own tool with the
   [add-a-tool](skills/add-a-tool/SKILL.md) skill.
6. **How it works inside (10 min).** Gemini Live, LiveKit, NON_BLOCKING tools and ephemeral
   tokens: [How it works inside](#how-it-works-inside).

## The kit

Copy these into your own projects:

- [`prompts/`](prompts/README.md): the real prompts the agent sends to Gemini (tidy, chat
  summary). The code reads them from these files.
- [`skills/`](skills/README.md): skills for coding agents, like adding a tool or bringing your
  own brain.
- [`tools/`](tools): every tool the agent can call, one small file each, with "why" comments.
- [`sample-brain/`](sample-brain/README.md): the shape of a brain.

## Develop

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
(a test reminds you). The voice check by hand: [`docs/voice-manual-check.md`](docs/voice-manual-check.md).

**Build the app** (needs Rust via rustup and Go, for the bundled LiveKit server):

```sh
cd app
bun install
bunx tauri build --debug   # builds the core (bun 1.4.4 --compile), LiveKit and the window
```

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml) on a
`v*` tag: build, install-test on a clean Mac with `get.sh`, then publish.

The plan: [`docs/spec.md`](docs/spec.md). Decisions and reasons: [`docs/plan.md`](docs/plan.md)
and [`docs/adr/`](docs/adr). Work is tracked in [`tickets/`](tickets).
