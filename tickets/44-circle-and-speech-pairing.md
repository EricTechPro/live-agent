# 44: a circle pairs with the next thing said

**What to build:** A circle drawn in silence sent its label at once, so Jett answered before the question, and a "what's this?" said a moment later lost the circle. Now the circle waits for its words.

**Blocked by:** none

**Status:** done

**Priority:** after-talk

- [x] Circled while talking: as before, the label goes on release
- [x] Circled in silence (`src/screen/service.ts`): the label waits; the next hold's words, the next typed turn, or speech with the mic open carries it; used once
- [x] Nothing said for about 4 s (`screenAskMs`): Jett asks in one line, like "What about this?"
- [x] Tests through the event stream: `test/screen-aware.test.ts` ("a circle pairs with the next thing said")
