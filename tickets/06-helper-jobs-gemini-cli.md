# 06: Helper jobs with Gemini CLI

**What to build:** The user says something like "fix this bug in project X" and the agent starts a helper job using Gemini CLI, in the background, while the voice keeps talking. The orchestrator tracks job states (queued, running, done, failed, cancelled), respects max-at-once from the config, can cancel a job, and tells the agent when a job finishes so it can announce it. Starting a helper is a helper-class tool, so it goes through the safety gate.

**Blocked by:** 02 Read-file tool behind the safety gate, 03 Config file

**Status:** done

**Priority:** must-have

- [x] A helper request produces a job-started event and the voice reply does not wait for the job
- [x] Job state changes appear on the event stream in order
- [x] With max-at-once 1, a second job waits in queued until the first ends
- [x] Cancelling a running job moves it to cancelled and stops the process
- [x] If Gemini CLI is missing or not signed in, the job fails with a message saying how to fix it
- [x] When a job finishes, the agent says so in the conversation

## Comments

**2026-11-14, helper auth change (user decision).** Google shut off Gemini CLI's free
"Login with Google" tier for this client: a real helper run failed with
`IneligibleTierError ... UNSUPPORTED_CLIENT`. The helper now runs Gemini CLI on the same
Gemini key as the voice (passed only as `GEMINI_API_KEY`), with a private CLI home owned by
live-agent (`GEMINI_CLI_HOME`, default `<OS app-data>/live-agent/gemini-cli`) whose
`.gemini/settings.json` selects `gemini-api-key`. The user's own `~/.gemini` login and
settings are never read or touched, and `HOME` is unchanged, so git in the project works as
before. "Ready" now means installed + a key present; no key fails with a fix pointing to
`README.md#get-your-gemini-key`, and exit code 41 now means the key was rejected. The
doctor (ticket 11) drops the sign-in check for Gemini CLI. Verified end to end with real
Gemini Live and real Gemini CLI 0.68 fixing an off-by-one bug on disk.
