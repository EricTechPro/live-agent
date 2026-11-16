# Config and doctor

Short version: [README](../README.md#customise-it).

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
| `worktrees` | give each helper job its own git worktree and branch, so it never touches your checkout ([Worktrees](helpers.md#worktrees)) | `false` |
| `voice` | Gemini Live voice name, e.g. `Puck`, `Kore`, `Charon` (not wired yet: today it always uses Gemini's default voice) | `Puck` |

The full rules are in [`src/config/config.schema.json`](../src/config/config.schema.json). Point your
editor at it with `"$schema"` for autocomplete. A bad value stops the app with a message that
names the field.

## Safety modes

Every tool has a **risk class**. The mode decides what each class may do:

| risk class | example tools | Ask me | Auto edits | Bypass |
|---|---|---|---|---|
| read | `search_brain`, `read_file`, `draw`, `edit_canvas` | runs | runs | runs |
| edit | `remember`, `cancel_job` | asks | runs | runs |
| command | (shell commands) | asks | asks | runs |
| helper | `start_helper` | asks | asks | runs |

On screen the modes read **Ask first** (`ask-me`), **Auto** (`auto-edits`) and
**Full access** (`bypass`).

"Asks" means the agent asks you first and waits for your yes. Today the yes has to be typed
in the window; a spoken yes is still on the to-do list. A blocked or declined call is
explained in the agent's own voice, and every verdict shows in the window.

Switch modes with <kbd>Shift</kbd>+<kbd>Tab</kbd> (Ask me → Auto edits → Bypass) or the
dropdown in the bottom bar. That change lasts until the app quits; the file sets the mode
it starts in.

## Per-tool overrides

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

## Helpers

`helpers.geminiCli`, `helpers.codex` and `helpers.claudeCode` let the agent start jobs with
that helper; turning one on is what allows it. `maxAtOnce` keeps your laptop
cool: with `1`, a second job waits until the first is done. See [Helper agents](helpers.md).

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
A bad key points you back to [Get your Gemini key](gemini-key.md).

The installed app and its doctor only use the key in `~/Desktop/live-agent/.env` (or one you set in
the environment), never a `.env` in the folder you happen to run them from.

**The log.** Opened from Finder, the app keeps what its core says in
`~/Desktop/live-agent/logs/core.log` (small: old lines are dropped). The key and every token are
hidden in it. The **Show log** button in the window shows the file in Finder.
