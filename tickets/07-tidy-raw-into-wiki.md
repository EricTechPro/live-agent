# 07: Tidy raw into wiki in the background

**What to build:** After a chat's raw note is saved, a background tidy job turns new raw notes into clean wiki pages (Karpathy-style raw to wiki). It runs as a helper job, shows up like any other job, and never blocks the voice.

**Blocked by:** 05 Save a raw note at chat end, and "remember this", 06 Helper jobs with Gemini CLI

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Ending a chat queues a tidy job
- [ ] The tidy job creates or updates wiki pages from new raw notes
- [ ] Raw notes are kept, not deleted
- [ ] The tidy job appears as a normal job with states on the event stream
- [ ] A tidy failure never breaks the next chat
