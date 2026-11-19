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
- **Installer**: fresh-machine run in CI creates the folder, sample brain and `.env`. The config is written by the first-run setup chat, by design, not by the installer.

Not tested automatically: the Tauri window layout and the mini orb. Checked by hand before the talk.

Prior art: live-dj `adk_tools/smoke_live.py` (text-turn live smoke) and `adk_tools/policy.py` (one gate before every tool, verdicts streamed to the UI).

## Out of Scope

- Phone calls over LiveKit Cloud / SIP.
- Building the app from source in the codelab (Rust stays out of the room).
- More than one helper at once by default (allowed in config, not tuned).
- Syncing the brain across devices.
- Windows and Linux polish (macOS first for the talk).
- Scheduled runs while Jett is closed, and catching up missed runs (see the workflows addendum: scheduling itself is in scope now).

## Further Notes

- Nov 27 must-haves: install, voice, brain read, raw save and tidy, Gemini CLI helper, 3 safety modes, doctor. If time runs short, cut in this order: worktrees, Codex and Claude Code adapters, mini orb, diagram tool.
- Codelab flow: demo 5 min, setup 15, customise 10, brain 10, tools and uses 10, how it works inside 10.
- Demo backup: publish the YouTube showcase first, play it if live fails.
- Venue wifi stays a risk. Post the install link 2 days before the talk.
- No issue tracker is set up for this project. Run `/setup-matt-pocock-skills` to publish this spec as an issue.

## Addendum: Jett v2 layout, call controls and sketch canvas (2026-11-15)

Approved by Eric on 2026-11-15. Tickets 21 to 35. Where this addendum and the sections above disagree, this addendum wins.

### Goal

Jett should feel like a real "Jarvis": you talk, it answers, it shows. Less text everywhere. Words on screen only where they carry something the voice can't (a file, a job result, an approval). Buttons are icons with tooltips, not labels.

### Two layers

- **Home.** A big animated orb (the existing pixel LED orb, `app/src/led-orb.ts`) and almost nothing else: the call controls and one way into the control center. You just talk.
- **Control center.** Opened from home, closed with an X (Escape too). Laid out like the Codex / ChatGPT desktop apps:
  - **Left sidebar:** past chats, and the second brain file tree (`raw`, `wiki`, `projects`, using the configured `brainFolders` names). Click a file to read it.
  - **Middle:** a clean ChatGPT-style chat. The orb sits small at the top. The composer at the bottom holds the text input, the safety mode pill and the inline approval cards.
  - **Right panel:** tabs for **Canvas** (the sketch canvas) and **Jobs** (the existing job board).
- The mini orb (ticket 15) stays as it is.

### Call controls and icon buttons

- Icons only, each with a tooltip and an `aria-label`, all reachable by keyboard:
  - **Start call** (mic / phone), **Pause** that becomes **Resume**, **End call** (red hang-up).
  - **Close (X)** for panels and the control center.
  - The top bar's text buttons (New chat, Setup, Show log, Mini, Jobs) become icon buttons too. Jobs keeps its running count as a small badge.
- Space still toggles pause. Shortcuts show in the tooltip.

### Safety mode in the composer, approvals inline

- The Ask me / Auto edits / Bypass switch moves from the bottom bar dropdown into the chat composer: a small pill at the left of the input, like ChatGPT's model picker. Click to pick; Shift+Tab still cycles. The core's `mode.changed` event stays the only source of truth.
- A gate verdict of `ask` also shows as an approve / deny card next to the composer, not only as the spoken "May I…?". Approving or denying in the card does the same as a spoken yes or no. The core gets one new way in (approve or decline a call by id), and the outcome shows on the event stream like a spoken answer.

### Job cards

Each job card shows: a short readable title (not the raw prompt cut off), which helper (Claude Code, Codex, Gemini CLI, or Tidy), state, elapsed time, and when done a one-line plain summary of the result. The card expands to show the full output. The core adds what the card needs to `job.state` (helper id, started and ended times, a short title, the full output).

### Helper workspace (bug)

A helper job with no folder must work in the user's brain folder (the configured `brainPath`), and relative folders start there, as the system prompt already says. Never in the app's own home folder (`~/Desktop/live-agent`), which is not a project. A folder that doesn't exist fails with a plain fix, and every job shows the folder it works in.

### Sketch canvas

Replaces the one-shot Mermaid `draw_diagram` tool. Roamies inspired the idea. Roamies is AGPL: borrow ideas only, never its code.

- **`draw` tool** (risk `read`, NON_BLOCKING): `beats: [{ say, marks[] }]`. Each beat is one spoken line plus the marks drawn while it is said.
- **Marks** are small shapes, each checked with Zod: `box`, `text` (label), `arrow`, `line`, `circle` (or ring), `underline`, `check`, `cross`, `step` (a numbered step), and `diagram` (a Mermaid card, so nothing the old tool did is lost; ticket 35, after `draw_diagram` has served the talk). Every mark has an id (`p1`, `p2`, …) that later turns can use: "make p2 red", "erase p3". Coordinates are on a fixed virtual board (for example 1000 × 600), so the window can scale it.
- **Edits:** the same tool (or a sibling) takes `edit` (by id: colour, label, position) and `erase` (by id, or all). The canvas keeps its marks across turns until erased or a new chat starts.
- **Window:** the Canvas tab draws marks with hand-drawn pen strokes that animate from 0 to 1. A beat's strokes are timed to its spoken line.
- **Event stream:** the core emits `canvas.*` events (`canvas.beat` with the checked marks, `canvas.edit`, `canvas.erase`). Bad marks are a tool error the model hears, and nothing reaches the window.

### Testing

Same single seam: the core's event stream. Core-side tickets (21, 23, 24, 28, 29, 31, 33, 34) add tests through it with the scripted fake model. Window-only pieces get pure reducer tests like `app/src/diagram.ts` and `app/src/transcript.ts`, plus a hand check in the real app.

### DevFest order

Must-have before Nov 27: 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32. If time runs short, cut in this order: 32 (keep `draw_diagram`), 31, 29, 23. After the talk: 24, 33, 34, 35.

## Addendum: Jett v3: floating overlay (2026-11-15)

Asked for by Eric after trying v2 on 2026-11-15. Tickets 36 and 37. Where this addendum and the v2 addendum disagree, this one wins.

### Why

v2 was too big: a 960 x 600 window with three columns feels like a desktop app, and it was unclear whether Jett was listening. Jett should feel like Roamies: a small orb floating over whatever you are doing, captions of what is said, drawings straight on the screen. Same experience, our own code (Roamies is AGPL: never its code, assets or text).

### The overlay window (ticket 36)

- **One full-screen transparent window** on the main screen: frameless, no shadow, no background, always on top, on every Space. macOS needs `macOSPrivateApi` (and the `macos-private-api` Cargo feature) for the transparent webview.
- **Click-through everywhere except the interactive bits.** The window ignores the mouse (`set_ignore_cursor_events(true)`) and the clicks reach the apps under it. The window polls the cursor (a Rust command, about 20 times a second) and stops ignoring the mouse while the pointer is over the orb, its buttons, the popover, an approval card or the canvas X. The hit test is pure (`app/src/overlay.ts`) with tests. While the setup wizard shows, the window takes every click.
- **At rest: just the orb and the captions.** The orb is small and floats where you put it: drag it by its grip, and it remembers the spot across launches (kept on screen). First launch: bottom right.
- **Live captions** at the bottom centre of the screen: your words stream as you speak (the core's user `transcript` chunks from Gemini Live's input transcription), then Jett's reply the same way. Two short lines at most, yours and Jett's, styled differently, fading out a few seconds after the last word. A pure reducer (`app/src/captions.ts`) with tests.
- **The canvas draws straight on the screen**: the sketch board is see-through and sits in the screen's upper middle; pen strokes get a dark halo under their glow so they read over any background. It clears on a new chat, and a small X on its corner clears it by hand.
- **Everything else only when clicked**: a small menu button by the orb opens one compact glass popover (dark tint, blur, rounded, thin teal border) with one view at a time, picked by icon tabs: **Chat** (transcript, composer with the safety mode pill, notes used), **Jobs** (job cards), **Brain** (past chats, the file tree, the read-only reader). New chat, Setup and Show log are icon buttons in its tab row. Esc or its X closes it. A running-jobs badge on the orb opens it on Jobs.
- **Approvals** show as a small glass card next to the orb, not inside the popover.
- The mini orb (ticket 15) is gone: the orb is always mini now.
- **Follow my pointer** (Roamies' default) is an option in the popover; ours defaults to staying where you dragged it. While following, the orb trails the pointer and holds still when the pointer comes near, so you can click it.
- **The drawing is a terminal-style glass card** (title bar, X) placed in the empty half of the screen, away from the orb; its marks draw in step with the voice as before.
- **No Dock icon**: Jett is a macOS accessory app with a menu-bar icon. Clicking the icon opens the popover; its menu has Open, Show / hide and Quit (quitting still lets the core save the chat).

### Calls like a phone call (ticket 37)

- **Not in a call: one button, Start call.** One click and it is live. Clicking the orb does the same.
- **In a call: exactly two buttons, Mute (mic-slash when muted) and a red Hang up.** Mute stops the mic track in the window; the core keeps running. The user never sees a "pause". The core's pause stays for the API but the window no longer uses it.
- **State at a glance, in plain words**: "Tap to talk", "Connecting…", "Listening…" (the orb's ring pulses with your voice level), "Thinking…", "Speaking…", "Muted" (orb dimmed, mic-slash badge), "Call ended". Each state has its own orb colour and motion. The mapping is a pure function (`app/src/call-state.ts`) with tests.
- **Keys**: Space starts a call, and in a call mutes and unmutes. Cmd+. hangs up. Esc closes the popover or the reader first; else, while Jett speaks, it stops the reply (the core's new `POST /reply/stop`, an `interrupted` on the stream, the call stays on); else, in a call, it hangs up. Tooltips show the keys.
- **Push to talk, anywhere**: hold Ctrl+Option to talk, let go to send, like a dictation app. The press opens the mic (starting a call if there is none); letting go closes it again 1.2 s later (so Gemini hears the quiet after your sentence), unless the mic was already open before. A hold must last 250 ms, so Ctrl+Option+S never starts talking. Read from the macOS modifier flags in the same Rust poll as the cursor (no global shortcut can be just two modifiers). Pure step function (`pttStep` in `app/src/overlay.ts`) with tests.
- **Show / hide**: Ctrl+Option+S (a global shortcut) hides Jett or brings it back.
- **Cues beside the orb** (Roamies-like, our own code): listening shows a small pill of equaliser bars that move with your mic level, with your words; working shows a pill with a spinner naming the action ("Asking Claude Code…", "Searching your notes…", from the tool calls); speaking shows a speech bubble with a tail pointing at the orb, folded to three lines with a chevron for long replies. While a drawing is on screen the words move to the bottom-centre caption bar instead. Pure (`app/src/cues.ts`) with tests.
- **Language**: Jett always answers in the language the user spoke (rule in the system prompt). The window's state words follow the user's last spoken language (English and Chinese).

### Later (not built; tickets 38 and up when Eric wants them)

Seen in the Roamies demo, left for later:
- A menu-bar drop-down panel with a sidebar: Home, Memory, Model, Appearance, Voice, Behavior.
- A floating reminders card.
- A new onboarding: look and size; permissions (mic, screen, accessibility, files) with ALLOWED badges; brain = Gemini key plus optional Claude / ChatGPT helper sign-in; reply mode.
- Screen capture only on request, and a hotkey to ask about an area of the screen.

### Testing

Pure code with tests: `app/src/overlay.ts` (also follow, card placement, push to talk), `app/src/cues.ts`, (orb and popover placement, hit test), `app/src/call-state.ts`, `app/src/captions.ts`, `app/src/panel.ts`, the language rule in the system prompt. Screenshots in a headless browser over a busy background. A hand check in the real app for transparency, click-through, dragging and voice.

### Why the app went to "Paused" by itself (v2)

The core pauses only when the window posts `/pause` (nothing in the core pauses on its own). In v2, Space toggled pause whenever focus was not in a text field or button, and on macOS WebKit a clicked button never takes focus (starting a call also disables the button for a moment), so focus stays on the page. So a Space press after the call started (for example to talk, push-to-talk style) paused Jett. v3 has no pause in the window: Space is Start call or Mute, and Muted shows only when you chose it.

## Addendum: computer control (2026-11-19)

Eric's call, 2026-11-19: Jett gets full computer control, like Roamies. This reverses the old out-of-scope line "Clicking or typing in other apps". Roamies is AGPL: we borrow the idea only, never its code, assets or text. Every file here is our own.

### Tools

- `open` (risk `act`): an app by name (`open -a`), a web address (a bare domain gets `https://`), or a file or folder path. The core checks the input and runs macOS `open` with an argv array, never a shell: flags, shell characters, odd link schemes and missing paths are refused (`src/screen/hands.ts` `openArgv`).
- `act_in_app` (risk `act`): an app and a list of steps, done in order: `click_text` (found by the same locator as `find_on_screen`, then an Accessibility press at its centre, else a real click), `click_at`, `type`, `key`, `scroll`, `wait`, `focus`. A closed app is launched in the background (`open -g -a`) and brought to the front first. A failed step stops the rest, and the model hears which step and what was done before it.
- `list_windows` (risk `read`): running apps and on-screen windows.
- `run_command` (risk `command`): one short shell command in the work folder, output back.

### The helper

`jett-eyes` (our Swift, `app/src-tauri/eyes/main.swift`) gains `ax-press`, `click-at`, `type` (unicode key events), `key` (combos like `cmd+t`), `scroll`, `windows` and `focus`. The input commands need Accessibility: without it they exit 3 and Jett says how to turn it on.

### Safety

A new `act` risk class: ask first in Ask first and Auto, run in Full access. One rule beats the mode and any config `allow` override: a click or key whose target words are delete, remove, pay, buy, send, submit, sign out, log out or purchase (or Cmd+Delete) always asks, even in Full access. Typed words do not count ("send me the deck" is just typing). A config `block` still blocks.

### Testing

Through the event stream with fake hands and fake eyes (`test/computer-control.test.ts`): the verdicts per mode, the risky rule, launch then focus then steps, a failed step, Accessibility off, the `open` input checks. The Swift helper is checked by building it and by hand on a real Mac.

## Addendum: workflows and scheduler (2026-11-19)

Eric's call, 2026-11-19 (plan: orchestrator + helpers). Gemini stays the orchestrator; saved and scheduled work runs as helper jobs. This moves scheduling out of Out of Scope.

### Files in Jett's home

Jett's home is the folder the config is read from: `LIVE_AGENT_HOME` when installed (the core `chdir`s there), the repo when run from source.

- Workflows: `.agents/workflows/<name>.md`. Frontmatter `name`, `description` (one line), `trigger` (`manual` or a 5-field cron in local time, numbers only, e.g. `"0 8 * * 1-5"`), `helper` (optional; left out = the default helper). The body is the helper's task.
- Skills: `.agents/skills/<name>/SKILL.md`, the standard Claude / Codex format. Every helper task (start_helper, workflows) ends with the skills folder and each skill's one line, because helpers work in the brain or a worktree, where neither Codex (`.agents/skills` from its cwd up to the git root) nor Claude Code (`.claude/skills`) would find them.

### Tools

- `list_workflows` (read), `run_workflow` (helper: submits a job like `start_helper`, in the brain folder), `create_workflow` and `delete_workflow` (edit; the schedule is checked before anything is written).
- `write_file` (edit): a quick text file inside the brain; any path that leaves it, also through a symlink, is refused. Bigger file work goes to a helper.

### Scheduler

In the core process (`src/workflows/scheduler.ts`): runs only while Jett is open, reads the files on every tick (twice a minute, at most one run per workflow per matching minute), and skips missed runs. Scheduled jobs go straight to the jobs runner with no approval card, in every mode (Eric's call); they show on the job board like any job. A helper that is off shows as a failed job with the fix.

### Teaching Gemini

Each connection's system instruction lists the workflows and skills (name and one line) and the rules: `create_workflow` for "every X, do Y", `run_workflow` by name, `write_file` for quick notes, `start_helper` for big work. A new chat picks up new files.

### Testing

`test/workflows.test.ts` (cron, files, skills, scheduler with a fake clock) and `test/workflow-tools.test.ts` (the tools, the session's scheduler and the system prompt, through the event stream with a fake helper CLI).
