# 16: Diagram tool

**What to build:** Asked to draw something, the agent produces a diagram and the window shows it. Read-class tool, runs NON_BLOCKING.

**Blocked by:** 02 Read-file tool behind the safety gate, 09 Desktop window: orb, transcript, talk out loud

**Status:** ready-for-human

**Priority:** after-talk

- [x] "Draw how this works" produces a diagram shown in the window
- [ ] The voice keeps talking while the diagram renders
- [x] The diagram tool call shows on the event stream

## Comments

2026-11-14: unparked by Eric ("finish all the tickets").

**Built (agent, 2026-11-14).** New tool `tools/draw_diagram` (`tools/draw-diagram.ts`, risk `read`,
NON_BLOCKING like every tool). The model sends Mermaid `source` and an optional `title`. The tool calls
the new `ToolContext.showDiagram()`, and the core emits one new event right away:
`{ type: "diagram", id, title?, source }` (`id` is the tool call). Empty source is a tool error the model
hears, and nothing reaches the window.

The window: `app/src/diagram.ts` (pure reducer: the latest diagram wins, `chat.started` clears it) and
`app/src/diagram-view.ts` (a panel above the transcript, with a close button). Mermaid 11 is an app
dependency, bundled by Vite and loaded on the first diagram (no CDN; `securityLevel: "strict"`). Bad
source shows "Could not draw this diagram: <parse error>" plus the source in the panel. The window keeps
working. The mini orb hides the panel.

Verified: `test/diagram.test.ts` (scripted model: tool.call with risk read, allow verdict, the `diagram`
event after the voice's words, turn ends normally; empty source; panel reducer). Built app/dist in
Playwright against a real core with real Gemini Live: a typed "draw a diagram of how a voice question
flows" turn drew a 5-box flowchart, and the agent replied in text. No request left 127.0.0.1. A broken
diagram event showed the parse error, and a good one after it drew fine.

Left for a person: hear the voice keep talking while a diagram renders (spoken turn in the real app).
