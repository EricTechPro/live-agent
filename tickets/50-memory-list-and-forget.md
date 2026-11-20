# 50: what I remember, and forget

**What to build:** Gap scan #7. A list of the facts `remember` saved, in the Brain tab, each with Forget; a `forget` tool for "forget that".

**Blocked by:** 41 image cards

**Status:** ready-for-human

**Priority:** after-talk

- [x] `src/brain/memory.ts`: `<brain>/.memory.json`, one line per fact with the raw note it was saved as; `remember` adds one
- [x] `forget` tool (by words or id; an unclear match lists the ids) and `POST /memory/forget`: the line goes, and the raw note `remember` wrote is deleted (a wiki page the tidy already made is left alone)
- [x] `memory` event; "What I remember N" with a Forget link per row in the popover's Brain tab (`app/src/memory-view.ts`)
- [x] Tests in `test/orb-actions.test.ts`
- [ ] Owner: decide whether Forget should also delete the raw note (it does now)
