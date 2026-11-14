# 11: Doctor check

**What to build:** A doctor command checks everything a new user needs: Gemini key works, mic is available, local LiveKit starts, and which helper CLIs are installed and signed in. Each failure prints one plain fix.

**Blocked by:** 06 Helper jobs with Gemini CLI, 08 Voice over local LiveKit with ephemeral tokens

**Status:** done

**Priority:** must-have

- [x] All checks pass on a working machine
- [x] A missing or bad Gemini key gives a fix that points to the key guide
- [x] LiveKit not starting gives a clear fix
- [x] A missing helper CLI is a warning with an install hint, not a failure, unless that helper is turned on
- [x] Exit code is non-zero only when something required fails

## Comments

`bun run doctor` (dev) or `live-agent doctor` (compiled core binary): `src/doctor/index.ts`, tests in `test/doctor.test.ts`.
Required: Gemini key, microphone, LiveKit. Helper CLIs fail only when turned on in config, otherwise warn with an install hint.
LiveKit is started on a free port (never 7880 or 7990-7992) and stopped right away. The key fix points to `README.md#get-your-gemini-key` (ticket 14 writes that section).

Real run on the dev Mac (2026-11-14). Every check passes except the Gemini CLI sign-in, which is waiting on the user (it is on by default, so it fails with the sign-in fix):

```
live-agent doctor

✓ Gemini key: key works, gemini-3.8-live is available
✓ Microphone: default input: Bose QC Headphones
✓ LiveKit: local server starts (port 60639)
✗ Gemini CLI: installed, not signed in (turned on)
    Fix: Gemini CLI isn't signed in. Run `gemini` once in a terminal and choose Login with Google.
✓ Codex: installed (turned off)
✓ Claude Code: installed (turned off)

1 problem(s) to fix.
```
Exit code 1. No livekit-server left running afterwards.

Update 2026-11-14: Google shut off Gemini CLI's free "Login with Google" tier, so the helper now runs Gemini CLI on the Gemini key (see ticket 06 comments) and doctor no longer checks a sign-in. Real run after that change, exit code 0:

```
✓ Gemini key: key works, gemini-3.8-live is available
✓ Microphone: default input: Bose QC Headphones
✓ LiveKit: local server starts (port 52689)
✓ Gemini CLI: installed, uses your Gemini key
✓ Codex: installed (turned off)
✓ Claude Code: installed (turned off)

All checks pass.
```
