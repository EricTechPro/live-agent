---
name: bring-your-brain
description: Turn a folder of your own notes into a live-agent second brain (raw, wiki, projects) and point the config at it. Use when someone says "use my notes", "set up my brain", or "import my Obsidian vault".
---

# Bring your own brain

live-agent reads a plain folder of markdown. It needs three subfolders:

| folder | what goes in | who writes it |
|---|---|---|
| `raw/` | quick, messy notes: chat summaries, "remember this" notes, pasted text | the agent, and you |
| `wiki/` | one tidy page per topic (a person, a thing, a place, a plan) | the tidy job, and you |
| `projects/` | one page per project: goal, status, next step | you |

The agent answers from `wiki/` and `projects/` (the `search_brain` tool), and only ever
adds new files to `raw/` and writes pages in `wiki/`. It never deletes a note.

## Steps

1. **Make the folder, outside any public repo.** For example `~/brain`:
   `mkdir -p ~/brain/raw ~/brain/wiki ~/brain/projects`.
   Look at `sample-brain/` in the repo for the shape of each kind of page.
2. **Fill `projects/`** with one short page per project you want to talk about:
   a `# Title`, one line on the goal, a few bullets on status and next steps.
3. **Fill `wiki/`** with pages you already have (copy markdown files in as they are),
   or drop your messy notes into `raw/` and let the tidy job write the wiki pages for you.
4. **Point live-agent at it.** Either press **Setup** in the app window and pick the folder
   with "Use my folder" (it maps your own folder names onto raw, wiki and projects), or edit
   `~/Desktop/live-agent/live-agent.config.json`: `"brainPath": "/Users/you/brain"`.
   Restart the app; new settings apply on the next start.
5. **Check it.** Ask about something only your notes know. The bottom bar shows
   "Notes used" with the pages the answer came from. Then say "remember that my
   bike lock code is 1234" and look in `raw/` for the new note.

## Keep it private

- Never put your real brain inside the live-agent repo or any public repo.
- Your notes go to Gemini only when a question needs them (as tool results), and the tidy
  job sends new raw notes plus your wiki pages to Gemini to rewrite the wiki.
