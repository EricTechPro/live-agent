# 04: Brain answers with notes used

**What to build:** The repo ships a sample second brain with raw, wiki and projects folders filled with fake notes. Asked a question, the agent answers from wiki and projects and emits a notes-used event naming the notes it used. The brain path comes from the config. A real brain path is gitignored.

**Blocked by:** 02 Read-file tool behind the safety gate, 03 Config file

**Status:** done

**Priority:** must-have

- [x] The sample brain ships with a few believable fake notes in each folder
- [x] A question answerable from the sample wiki gets an answer plus a notes-used event listing the right notes
- [x] Pointing the config at another folder makes the agent read that folder instead
- [x] A real brain folder is ignored by git
- [x] Reading the brain is a read-class tool and never asks for permission
