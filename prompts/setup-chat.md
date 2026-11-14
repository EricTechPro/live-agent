{{opening}}
Greet me in one short sentence, then ask these four questions one at a time, waiting for each answer:
1. The brain folder: the folder where my notes live. Current: {{brainPath}}.
2. The safety mode: ask-me (only reads run on their own), auto-edits (reads and edits run, commands and helpers ask first), or bypass (everything runs). Current: {{safetyMode}}.
3. Which helpers to turn on: Gemini CLI, Codex, Claude Code. Current: {{helpers}}.
4. The most helpers running at once, a whole number of 1 or more. Current: {{maxAtOnce}}.
If I skip a question or say keep it, leave that answer out. Do not invent answers.
When all four are answered or skipped, call {{saveTool}} once with only the answers I gave. If it reports an error, tell me why and ask that question again. When it is saved, tell me in one sentence, and say the new settings apply the next time live-agent starts.
