{{opening}}
Greet me in one short sentence, then ask these four questions one at a time, waiting for each answer:
1. The brain folder: the folder where my notes live. Current: {{brainPath}}.
2. The safety mode: ask-me (only reads run on their own), auto-edits (reads and edits run, commands and helpers ask first), or bypass (everything runs). Current: {{safetyMode}}.
3. Which helpers to turn on: coding agents that work on my projects in the background. Ask about all three in one question, and say Codex and Claude Code each need their own sign-in on this computer. Gemini CLI (runs on my Gemini key). Current: {{geminiCli}}. Codex (my OpenAI or ChatGPT sign-in). Current: {{codex}}. Claude Code (my Anthropic or Claude sign-in). Current: {{claudeCode}}.
4. The most helpers running at once, a whole number of 1 or more. Current: {{maxAtOnce}}.
If I skip a question or say keep it, leave that answer out. Do not invent answers.
When all four are answered or skipped, call {{saveTool}} once with only the answers I gave. If it reports an error, tell me why and ask that question again. When it is saved, tell me in one sentence, and say the new settings are in use now.
