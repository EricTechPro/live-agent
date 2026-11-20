# 41: image cards: show a real picture, found or generated

**What to build:** Asked for "an image of an animal cell", Jett drew a Mermaid box tree: it had no way to show a real picture. A new `image` card kind and a `show_image` tool fix that, plus prompt rules for when to use it.

**Blocked by:** 35 diagram cards

**Status:** ready-for-human

**Priority:** must-have

- [x] Prompt (`src/core/tone.ts`): an image, photo or picture of a real thing goes to `show_image` mode find; draw, illustrate or make an image of something imaginary or stylized goes to mode generate; diagrams only for flows, structures or when asked; unsure: "Photo or diagram?" in one line
- [x] `image` card kind (`src/core/card-kinds.ts`, Zod in `src/core/canvas.ts`): title, `src` as a png / jpeg / webp data: URL (the window's CSP stays `img-src 'self' data:`), caption, credit; only `show_image` makes it, `draw` refuses it
- [x] Mode find (`src/images.ts`): Wikimedia Commons search (no key, generic User-Agent), bitmaps only, the file whose name has the most asked words first, the ~1024 px thumbnail downloaded in the core, capped at 4 MB, credit line "Wikimedia Commons · author · license"
- [x] Mode generate: Gemini image model `gemini-nano-banana-2.1` over the Interactions REST API (https://aistudio.google.com/docs/image-generation), the key in a header; caption "generated"
- [x] The card opens at once with "Getting the picture…" and fills in by a `canvas.edit` (`board.replace`); Jett keeps talking (NON_BLOCKING); no key, quota and a safety block are each one short spoken line, and the loading card goes
- [x] The window: `<img>` fitting the card at the picture's shape (measured on decode), caption and credit under it; pin, full screen and close work as on every card
- [x] Tests with fake HTTP through the event stream (`test/show-image.test.ts`), the layout (`test/layout.test.ts`); one real smoke run of each mode
- [ ] Owner: ask Jett for "a picture of an animal cell" and "draw me a cartoon animal cell" on the real Mac
