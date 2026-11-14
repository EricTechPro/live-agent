# 10: Job board, bottom bar, mode switching

**What to build:** The right side of the window shows a small job board: each helper job with waiting, working, done or failed, and a cancel button. A bottom bar shows which brain notes the last answer used and the current safety mode. Shift+Tab cycles Ask me, Auto edits and Bypass; a dropdown in the bottom bar does the same.

**Blocked by:** 04 Brain answers with notes used, 06 Helper jobs with Gemini CLI, 09 Desktop window: orb, transcript, talk out loud

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Starting a helper job by voice shows it on the board and it moves through states live
- [ ] Clicking cancel on a job cancels it
- [ ] The bottom bar shows notes used after a brain answer
- [ ] Shift+Tab cycles the three modes and the gate uses the new mode immediately
- [ ] The dropdown and Shift+Tab always show the same mode
