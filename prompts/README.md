# Prompts

The real prompts live-agent sends to Gemini. The code imports these files as they are
(`import ... with { type: "text" }`), so what you read here is exactly what the model gets.
Change one, restart, and the agent behaves differently. Copy them into your own projects.

| file | what it does |
|---|---|
| [`tidy.md`](tidy.md) | System prompt for the tidy job: folds new raw notes into clean wiki pages, Karpathy-style. Used by `src/models/gemini-tidy.ts`. |
| [`chat-summary.md`](chat-summary.md) | What the agent is asked when a chat ends, to write the short chat-end note into `raw/`. Used by `src/core/agent.ts`. |
| [`setup-chat.md`](setup-chat.md) | The hidden first message of the setup chat: the four questions and how to save them. `{{slots}}` get the current settings. Used by `src/setup/index.ts`. |

The other half of the "prompt" is each tool's `description` in `tools/`: it tells Gemini
when to call that tool and what to say after. For example `tools/search-brain.ts` says
"use it whenever the user asks about their own life, plans, people, projects...".

Adding a prompt? Put the file here, import it with `with { type: "text" }`, and add one
line to the table above. `test/readme-kit.test.ts` fails if a file in this folder is not listed here.
