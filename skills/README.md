# Skills

Copyable skills for coding agents (Claude Code, Gemini CLI, Codex). Each one is a folder
with a `SKILL.md`: a short front matter (`name`, `description`) and the steps.
Copy a folder into your agent's skills folder (for Claude Code: `.claude/skills/`) and ask
for it by name, or just paste the steps into a chat.

| file | what it does |
|---|---|
| [`add-a-tool/SKILL.md`](add-a-tool/SKILL.md) | Add a new tool to live-agent: one file in `tools/`, a risk class, a test and the bundled-tools line. |
| [`bring-your-brain/SKILL.md`](bring-your-brain/SKILL.md) | Turn a folder of your own notes into a second brain (`raw`, `wiki`, `projects`) and point the config at it. |

Adding a skill? Make a folder with a `SKILL.md` and add one line to the table above.
`test/readme-kit.test.ts` fails if a file in this folder is not listed here.
