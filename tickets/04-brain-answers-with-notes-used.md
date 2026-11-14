# 04: Brain answers with notes used

**What to build:** The repo ships a sample second brain with raw, wiki and projects folders filled with fake notes. Asked a question, the agent answers from wiki and projects and emits a notes-used event naming the notes it used. The brain path comes from the config. A real brain path is gitignored.

**Blocked by:** 02 Read-file tool behind the safety gate, 03 Config file

**Status:** ready-for-agent

**Priority:** must-have

- [ ] The sample brain ships with a few believable fake notes in each folder
- [ ] A question answerable from the sample wiki gets an answer plus a notes-used event listing the right notes
- [ ] Pointing the config at another folder makes the agent read that folder instead
- [ ] A real brain folder is ignored by git
- [ ] Reading the brain is a read-class tool and never asks for permission
