# Your second brain

A brain is a plain folder of markdown files with three parts:

| folder | what goes in | used for |
|---|---|---|
| `raw/` | quick, messy notes: chat-end notes, "remember this" notes | the tidy job's input |
| `wiki/` | one clean page per topic (a person, a thing, a plan) | answers |
| `projects/` | one page per project: goal, status, next steps | answers |

How it flows:

- **Answers.** When you ask about your own life, Gemini calls `search_brain`, which searches
  `wiki/` and `projects/`. The bottom bar shows **Notes used** for that answer.
- **Chat-end note.** When a chat ends, the agent writes a two-to-five-bullet summary of it into
  `raw/` (for example `raw/2026-11-14-chat.md`). Nothing you said is lost.
- **"Remember this."** Say "remember that the gate code is 4512" and the `remember` tool writes
  a raw note right away.
- **Tidy.** A background job reads new raw notes and folds them into `wiki/` pages,
  Karpathy-style: update a page when the topic exists, make a new one when it doesn't, never
  invent facts. It only ever writes inside `wiki/`, and it shows on the job board. The prompt
  it uses is [`prompts/tidy.md`](../prompts/tidy.md). A chat ends (note saved, tidy queued)
  when you press **New chat**, after ten quiet minutes, or when the app quits.

Use your own notes: the [`bring-your-brain`](../skills/bring-your-brain/SKILL.md) skill walks
through it. In short, make `raw/`, `wiki/` and `projects/` in a folder, then set `brainPath`.
Keep your real brain out of any public repo; this repo only ships the made-up sample.
