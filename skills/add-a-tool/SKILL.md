---
name: add-a-tool
description: Add a new tool to live-agent (one file in tools/), with a risk class, a test and the bundled-tools line. Use when someone says "add a tool", "let the agent do X", or "connect live-agent to Y".
---

# Add a tool to live-agent

A tool is one file in `tools/` that default-exports `defineTool({...})`.
Gemini Live sees its `name`, `description` and `parameters`, and calls it when it fits.
The safety gate decides from its `risk` whether it runs, asks first, or is blocked.

## Steps

1. **Pick the risk class.** It is the only safety decision you make.

   | risk | use it when the tool... | Auto edits (default) |
   |---|---|---|
   | `read` | only looks (reads a file, searches notes, calls a read-only API) | runs |
   | `edit` | changes notes or files the user owns | runs |
   | `command` | runs a shell command or changes things outside the brain | asks first |
   | `helper` | starts a background helper agent | asks first |

   When unsure, pick the stricter one.

2. **Write `tools/<name-with-dashes>.ts`.** Copy this and change it:

   ```ts
   // weather: today's weather for a city. Read only.
   import { defineTool } from "../src/core/tool.ts";

   export default defineTool<{ city: string }>({
     name: "weather",                 // letters, digits, underscores
     description:                     // written for the model: WHEN to call it, and what to say after
       "Get today's weather for a city. Use it when the user asks about the weather. " +
       "Answer in one short spoken sentence.",
     risk: "read",
     parameters: {
       type: "object",
       properties: { city: { type: "string", description: "City name, e.g. Vancouver" } },
       required: ["city"],
     },
     async run({ city }) {
       const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
       if (!res.ok) throw new Error(`weather service said ${res.status}`); // the model hears this
       const data: any = await res.json();
       return { city, tempC: data.current_condition?.[0]?.temp_C, sky: data.current_condition?.[0]?.weatherDesc?.[0]?.value };
     },
   });
   ```

   - Return small plain JSON. The model reads it out loud, so keep it short.
   - Throw an `Error` with a plain sentence when it fails; the model tells the user.
   - Need the brain? `run(args, { brainPath, useNotes, brainWrote })`: call `useNotes([...])`
     for notes you read and `brainWrote(path)` for notes you wrote, so the app shows them.
   - Long work (minutes)? Don't block: submit a job with `context.jobs.submit(...)` and return
     the job id at once, like `tools/start-helper.ts`. Every tool already runs NON_BLOCKING,
     so the voice keeps talking while `run()` works.

3. **Add one line to `src/core/bundled-tools.ts`** (import it and add it to the list).
   The installed app is one compiled file and can't read `tools/` at run time.
   `test/bundled-tools.test.ts` fails until you do.

4. **Test it through the event stream** (`test/tools.test.ts` shows the pattern): start a
   session with `scriptedModel` that calls your tool, then check the `safety.verdict` and
   the tool result events. Run `bun test`.

5. **Try it for real.** `bun run start` (reads `tools/` from source), open the printed
   `/check` page, and ask for it out loud. Want it to always ask first? In
   `live-agent.config.json`: `"safety": { "overrides": { "weather": "ask" } }`.

## Done when

- [ ] `tools/<name>.ts` with a clear `description` and the right `risk`
- [ ] the line in `src/core/bundled-tools.ts`
- [ ] a test, and `bun test` passes
