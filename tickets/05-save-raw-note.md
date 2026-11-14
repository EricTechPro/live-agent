# 05: Save a raw note at chat end, and "remember this"

**What to build:** When a chat ends, the agent writes one short dated note into raw summarising what was said and decided. Saying "remember this" writes a raw note right away. Each write emits a brain-write event.

**Blocked by:** 04 Brain answers with notes used

**Status:** done

**Priority:** must-have

- [x] Ending a session writes exactly one new raw note
- [x] "Remember this" mid-chat writes a raw note immediately
- [x] Each write emits a brain-write event with the note's name
- [x] Notes never overwrite existing raw notes
- [x] Fast tests check both paths through the event stream
