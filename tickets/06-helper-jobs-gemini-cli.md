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
