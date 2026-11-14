# Spec: live-agent v1

Status: ready-for-agent (local file; no issue tracker set up yet)
Date: 2026-11-13. Ship target: DevFest Vancouver, Fri 2026-11-27.
Source: grilling session, see `live-agent-plan.md`.

## Problem Statement

Builders want a voice AI they can actually talk to, that knows their own context and can do real work. Today they face three walls:

- Voice demos are toys. They answer, but they don't know anything about you and can't do anything for you.
- Setting up realtime voice is hard. Gemini keys, LiveKit servers, tokens, mic access and tool calls each break in their own way.
- Even when it works, the voice freezes while a tool runs, and there is no clear line between "it may do this" and "it must ask me first".

At DevFest, people mainly want to take a working kit home: the repo, the prompts and the skills, and use it to build their own.

## Solution

`live-agent` is a light desktop app you install with one command. You open it, talk to it, and it talks back in real time using Gemini Live, carried by a LiveKit server that runs on your own computer.

- It reads a **second brain** folder (`raw`, `wiki`, `projects`). It ships with a sample brain.
- After every chat it saves a short note to `raw`. In the background it tidies `raw` into clean `wiki` pages, so it learns slowly over time.
- It can call tools without freezing its voice.
- It can hand bigger jobs to **helper agents** (Gemini CLI by default; Codex and Claude Code if you turn them on). You see their progress on a small job board.
- A **safety mode** (Ask me / Auto edits / Bypass) decides what it may do without asking. Shift+Tab switches modes.
- One JSON file controls everything. A first-run setup chat fills it in for you.
- The repo ships the prompts and skills so people can copy them.

## User Stories

### Install and first run

1. As a new user, I want to install live-agent with one command, so that I don't follow a long setup guide.
2. As a new user, I want the installer to put a `live-agent` folder on my Desktop, so that I always know where my agent and brain live.
3. As a new user, I want to download a ready-built app, so that I don't need Rust or long builds.
4. As a new user, I want to need only a Gemini key on day one, so that I don't sign up for many services before hearing "hello".
5. As a new user, I want a clear README that shows how to get my Gemini key step by step, so that I don't get stuck at the first screen.
6. As a new user, I want LiveKit to start on my own computer automatically, so that I don't need a LiveKit account.
7. As a new user, I want a `doctor` check that tests my key, mic and LiveKit, so that I know exactly what's broken.
8. As a new user, I want the app to ask for mic access with a clear reason, so that I trust it.
9. As a new user, I want a first-run setup chat that asks me a few questions, so that my settings are right without editing files.
10. As a new user, I want the setup chat to save my answers in one JSON file, so that I can change them later.
11. As a new user, I want the app to work with the sample brain right away, so that I can try it before adding my own notes.
12. As a user, I want my real API key never stored in the app's front end, so that a leak can't expose it (ephemeral tokens).

### Talking

13. As a user, I want to talk and hear a reply in real time, so that it feels like a conversation.
14. As a user, I want to interrupt it while it speaks, so that I don't wait for long answers.
15. As a user, I want to see a voice orb that shows listening, thinking and speaking, so that I know what it's doing.
16. As a user, I want to see what I said and what it said as text, so that I can check it heard me right.
17. As a user, I want its voice to keep going while a tool runs, so that it never freezes (NON_BLOCKING tools).
18. As a user, I want it to tell me out loud when a background job finishes, so that I don't have to watch the screen.

### Second brain

19. As a user, I want it to answer from my `wiki` and `projects` notes, so that it knows my context.
20. As a user, I want to see which notes it used, so that I can trust or correct the answer.
21. As a user, I want it to save one short note to `raw` at the end of each chat, so that nothing I said is lost.
22. As a user, I want a background job to tidy `raw` into `wiki` pages, so that my brain stays clean without my effort.
23. As a user, I want the tidy job to show on the job board, so that I know when my brain changed.
24. As a user, I want to point live-agent at my own brain folder, so that I can use my existing notes.
25. As a user, I want my real brain never committed to the public repo, so that my private notes stay private.
26. As a user, I want to say "remember this", so that something important is saved right away.

### Tools

27. As a user, I want tools to live in one `tools` folder, so that I can add my own easily.
28. As a user, I want each tool's safety level set in the JSON, so that I control what needs my "yes".
29. As a user, I want it to read files I name, so that I can ask about any document.
30. As a user, I want it to draw a diagram on request, so that I can see ideas, not just hear them.

### Helper agents

31. As a user, I want to say "fix this bug in project X" and have it start a helper agent, so that real work happens while I keep talking.
32. As a user, I want Gemini CLI as the default helper, so that it runs on the same Gemini key as the voice and needs no extra sign-in.
33. As a user, I want to turn on Codex or Claude Code in the JSON, so that I can use the tools I already pay for.
34. As a user, I want to set how many helpers run at once (default 1), so that my computer doesn't slow down.
35. As a user, I want helpers to work in a git worktree when I turn it on, so that they don't mess up my main branch.
36. As a user, I want each job on the board to show waiting, working, done or failed, so that I can follow along.
37. As a user, I want to cancel a job by voice or by click, so that I can stop mistakes.
38. As a user, I want a clear message if a helper CLI isn't installed or can't authenticate (for Gemini CLI: no Gemini key, or the key is rejected), so that I know how to fix it.

### Safety modes

39. As a user, I want three modes, Ask me, Auto edits and Bypass, so that I choose how much it does alone.
40. As a user, I want Shift+Tab to switch modes, so that it's fast like Claude Code.
41. As a user, I want a dropdown in the bottom bar too, so that I can switch with the mouse.
42. As a user, I want the default to be Auto edits, so that it's smooth but still asks before commands and helpers.
43. As a user, in Ask me mode, I want it to ask out loud before risky tools and accept a spoken "yes", so that I stay hands-free.
44. As a user, when a tool is blocked, I want it to explain why in its own voice, so that I'm not confused.
45. As a user, I want every tool call logged, allowed or not, so that I can see what happened.

### Window and mini mode

46. As a user, I want a main window with the orb on the left and the job board on the right, so that I see voice and work together.
47. As a user, I want a bottom bar showing notes used and the safety mode, so that key status is always visible.
48. As a user, I want to shrink the window into a small floating orb, so that it stays out of my way.
49. As a user, I want the mini orb to show how many jobs are running, so that I know work is happening.
50. As a user, I want the app to use little RAM, so that it can stay open all day.

### Codelab and kit

51. As a DevFest attendee, I want to see a live demo first, so that I know what I'm getting.
52. As an attendee, I want to set it up, customise it, build my brain and connect tools in the room, so that I leave with it working.
53. As an attendee, I want a short "how it works inside" part on Gemini Live and LiveKit, so that I can build my own later.
54. As an attendee, I want the prompts and skills in the repo, so that I can copy them into my own projects.
55. As the speaker, I want a recorded YouTube showcase, so that I can play it if the live demo fails.

## Implementation Decisions

Modules (deep modules, small interfaces):

- **App shell (Tauri).** Window, mini orb, mic permission, Shift+Tab and dropdown, job board view, bottom bar. Talks to the agent core over one local event stream. No agent logic inside.
- **Agent core.** Owns the Gemini Live session over LiveKit. Takes audio or text turns in, sends audio, transcripts and events out. Single entry point: start a session with a config, send a turn, receive events.
- **Token service.** Mints ephemeral Gemini tokens and LiveKit tokens locally. The real key stays in the core's environment, never in the shell.
- **LiveKit runner.** Starts and stops a bundled local LiveKit server in dev mode. LiveKit Cloud only when phone calls are added later.
- **Tool registry.** Loads tools from the `tools` folder. Each tool declares a name, a description, a schema, and a risk class (read, edit, command, helper). All tools run NON_BLOCKING.
- **Safety gate.** One function at the door of every tool call, the same pattern as live-dj's `before_tool_callback`. Verdicts: allow, ask, block. Input: tool, args, risk class, current mode. Every verdict goes to the event stream.

  Mode table:

  | Risk class | Ask me | Auto edits | Bypass |
  |---|---|---|---|
  | read | allow | allow | allow |
  | edit | ask | allow | allow |
  | command | ask | ask | allow |
  | helper | ask | ask | allow |

  Per-tool overrides in the JSON win over the table.

- **Brain.** Reads `wiki` and `projects` for answers and reports which notes were used. Writes one raw note at chat end. "Remember this" writes a raw note right away.
- **Tidy job.** A helper job that turns new raw notes into wiki pages (Karpathy-style raw to wiki). Runs in the background after each chat. Never blocks the voice.
- **Orchestrator.** Gemini Live is the boss. Starts helper agents as background jobs. Enforces max-at-once. Optionally creates a git worktree per job. Job states: queued, running, done, failed, cancelled. Reports finished jobs back so the voice can announce them.
- **Helper adapters.** One adapter per CLI: Gemini CLI (default on), Codex and Claude Code (default off). Each adapter checks it is ready before running. Gemini CLI: installed and a Gemini key present; it runs on the core's key (passed as GEMINI_API_KEY) with a private CLI home owned by live-agent, so the user's own `gemini` login and settings are never touched. Codex and Claude Code: installed and signed in.
- **Config.** One JSON file, with a JSON Schema (like super-board's config schema). Holds: brain path, safety mode, helpers on/off, max at once, worktrees on/off, per-tool risk overrides, voice choice. The setup chat writes it.
- **Setup chat.** First-run flow, like super-board's setup script, but spoken or typed. Asks a few questions, writes the config.
- **Doctor.** Checks Gemini key, mic, LiveKit server, helper CLIs. Prints one fix per failure.
- **Installer.** One command, like super-board's `get.sh`. Downloads the ready-built app, creates the Desktop folder, copies the sample brain, starts setup.

Other decisions:

- Model: `gemini-3.8-live` handles hearing, thinking and speaking in one.
- Defaults: safety mode Auto edits; helpers max 1; worktrees off; Gemini CLI on.
- Sample brain ships in the repo. User brain paths are gitignored.
- Roamies is AGPL. Use its ideas (floating orb, onboarding feel), not its code.
- Teaching style follows live-dj: one concept per step, readable code with "why" comments.

## Testing Decisions

What a good test is: it drives live-agent the way a user does and checks what comes out. It does not check internal functions or private state.

Proposed seam (one, the highest): **the agent core's event stream.** Send a text turn in, read the events out: transcript, tool calls, safety verdicts, job state changes, notes used, brain writes. Text turns stand in for voice, same as live-dj's `smoke_live`.

Two ways to run tests through that one seam:

- **Fast tests (every change).** Agent core with a scripted fake model that returns planned tool calls. Checks: the safety table for every mode and risk class, per-tool overrides, raw note saved at chat end, tidy job queued, max-at-once respected, missing helper CLI gives a clear error, cancel works.
- **Live smoke (before release and before the talk).** The real Gemini Live model, a few text turns, like live-dj's smoke test. Checks: brain answer reports notes used, a read tool runs, an edit is blocked in Ask me mode, a helper job reaches done.

Also tested:

- **Doctor**: run with a missing key, no LiveKit, no helper CLI; each gives the right fix.
- **Installer**: fresh-machine run in CI creates the folder, sample brain and config.

Not tested automatically: the Tauri window layout and the mini orb. Checked by hand before the talk.

Prior art: live-dj `adk_tools/smoke_live.py` (text-turn live smoke) and `adk_tools/policy.py` (one gate before every tool, verdicts streamed to the UI).

## Out of Scope

- Phone calls over LiveKit Cloud / SIP.
- Building the app from source in the codelab (Rust stays out of the room).
- More than one helper at once by default (allowed in config, not tuned).
- Syncing the brain across devices.
- Windows and Linux polish (macOS first for the talk).
- Clicking or typing in other apps (Roamies-style screen control).
- Nightly tidy schedules (tidy runs after each chat only).

## Further Notes

- Nov 27 must-haves: install, voice, brain read, raw save and tidy, Gemini CLI helper, 3 safety modes, doctor. If time runs short, cut in this order: worktrees, Codex and Claude Code adapters, mini orb, diagram tool.
- Codelab flow: demo 5 min, setup 15, customise 10, brain 10, tools and uses 10, how it works inside 10.
- Demo backup: publish the YouTube showcase first, play it if live fails.
- Venue wifi stays a risk. Post the install link 2 days before the talk.
- No issue tracker is set up for this project. Run `/setup-matt-pocock-skills` to publish this spec as an issue.
