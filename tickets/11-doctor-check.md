# 11: Doctor check

**What to build:** A doctor command checks everything a new user needs: Gemini key works, mic is available, local LiveKit starts, and which helper CLIs are installed and signed in. Each failure prints one plain fix.

**Blocked by:** 06 Helper jobs with Gemini CLI, 08 Voice over local LiveKit with ephemeral tokens

**Status:** ready-for-agent

**Priority:** must-have

- [ ] All checks pass on a working machine
- [ ] A missing or bad Gemini key gives a fix that points to the key guide
- [ ] LiveKit not starting gives a clear fix
- [ ] A missing helper CLI is a warning with an install hint, not a failure, unless that helper is turned on
- [ ] Exit code is non-zero only when something required fails
