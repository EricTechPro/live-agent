# 21: Helper jobs start in the brain folder, not the app's home

**What to build:** Bug from Eric's screenshot: a Claude Code helper job answered "The current workspace (`/Users/erictech/Desktop/live-agent`) is not a Git repository". That folder is the app's home (config, key file, logs), not a project. A helper job with no folder must work in the configured brain folder (`brainPath`), and relative folders must start there. A folder that doesn't exist fails with a plain fix. Every job shows the folder it works in.

**Root cause:**
- The Tauri shell sets `LIVE_AGENT_HOME` to `~/Desktop/live-agent` (`app/src-tauri/src/lib.rs:59-65`, passed to the core at `:92`), and the core `chdir`s into it (`src/home.ts:29`).
- `startApp` never passes a `workDir`, so the session's `workDir` falls back to `process.cwd()`, which is that home folder (`src/core/agent.ts:146`).
- `start_helper` resolves its folder against `workDir`, defaulting to `"."`: `resolve(workDir, folder ?? ".")` (`tools/start-helper.ts:50`). Its schema also tells the model "Default: the working folder" (`tools/start-helper.ts:30`).
- The system prompt says the opposite: the default helper folder is the notes folder (`src/core/tone.ts:62`). The model trusts the tool schema and leaves `folder` out, so the helper runs in `~/Desktop/live-agent`. A relative `projects/<name>` would also land under the home folder instead of the brain.
- Eric's installed config has `"brainPath": "/Users/erictech/Desktop/EricOS"` and `"worktrees": false`, so nothing stopped the job before Claude Code ran in the wrong folder.

**Blocked by:** None

**Status:** done

**Priority:** must-have

- [x] A `start_helper` call with no folder starts its job in the brain folder (`ToolContext.brainPath`), checked through the event stream with the scripted fake model
- [x] A relative folder (`projects/live-agent`) resolves inside the brain folder; an absolute folder is used as given
- [x] A folder that doesn't exist fails the call with a plain fix the model hears, and no job starts
- [ ] Every `job.state` event for a helper job carries the folder it works in, and the job board shows it (core half done: `job.state.folder`; the job board half is window work, left to the app builder)
- [x] The `start_helper` schema and the system prompt say the same default (the brain folder)
- [x] Opened like the installed app (`LIVE_AGENT_HOME` set), a helper job never runs in the home folder

## Comments

- 2026-11-15 (core builder): `start_helper` resolves against `ToolContext.brainPath`, checks the folder exists, and every helper `job.state` (and the tool's first result) carries `folder` (absolute path). Tests: `test/helper-folder.test.ts`, with `workDir` set to a fake app home. Open: the job board does not render `folder` yet (`app/src/board-view.ts`, `app/src/job-board.ts`); that box stays unticked for the UI builder (fits ticket 29's card work).
