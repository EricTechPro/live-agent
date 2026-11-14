# 14: README, key guide and the kit

**What to build:** A README as easy as super-board's: what it is, a one-line install, a step-by-step Gemini key guide with screenshots, how to customise the config, how the brain works, and a short "how it works inside" section on Gemini Live and LiveKit. The repo ships the prompts and skills so people can copy them. Also the order of the DevFest codelab: setup, customise, build your brain, connect tools, real uses, how it works inside.

**Blocked by:** 13 One-command install and ready-built app

**Status:** ready-for-human

**Priority:** must-have

- [ ] A new user can go from zero to talking using only the README
- [ ] The key guide has every click, with screenshots
- [x] Prompts and skills live in clear folders with a one-line description each
- [x] A "how it works inside" section explains Gemini Live, LiveKit, NON_BLOCKING tools and ephemeral tokens in plain words
- [x] The codelab steps are listed in order

## Comments

**Built (agent, 2026-11-14).**
- `README.md` rewritten in plain words: what it is, one-line install and first run, `## Get your Gemini key`
  (anchor `get-your-gemini-key`, the one doctor and the helper fixes point to), customise (every config field,
  safety modes table, per-tool overrides, helpers), the second brain (raw / wiki / projects, chat-end note,
  "remember this", tidy), helper agents (Gemini CLI on your key, max at once, cancel), doctor,
  `## How it works inside` (ASCII diagram; Gemini Live, LiveKit, NON_BLOCKING tools, ephemeral tokens),
  the DevFest codelab in order, the kit, and an accurate Develop section. Features not built yet
  (Codex / Claude Code helpers, worktrees, the `voice` field, spoken "yes") are marked as such.
- The kit: `prompts/` holds the real prompts (`tidy.md`, `chat-summary.md`, `setup-chat.md`). The code now
  imports them as text (`with { type: "text" }`, typed by `src/text-imports.d.ts`), so the files ARE what Gemini
  gets; checked the setup kickoff text is byte-identical to before, and that `bun build --compile` embeds them.
  `skills/` holds `add-a-tool` and `bring-your-brain`. Each folder's README lists every file with one line.
- `test/readme-kit.test.ts`: every `README.md#anchor` in `src/`, `tools/`, `get.sh` exists as a README heading;
  in-page links resolve; linked files exist (except the key-guide screenshots); every file in `prompts/` and
  `skills/` has a one-line description in its folder README.

**Box 2 is open: the screenshots need a person.** They need a real Google account, so an agent can't take
them. The README already references these files; save each one under `docs/images/key-guide/`:

| file | what it shows |
|---|---|
| `01-open-ai-studio.png` | https://aistudio.google.com/apikey: the Google sign-in (or AI Studio landing) |
| `02-accept-terms.png` | first-visit Gemini API terms dialog: the agree box and **Continue** |
| `03-api-keys-page.png` | the **API keys** page, with the **Create API key** button (and a default key if there is one) |
| `04-create-key-dialog.png` | the **Create API key** dialog: key name, project picker / **Create project**, **Create key** |
| `05-copy-key.png` | the key details with the **Copy** button (blur the key itself) |
| `06-paste-in-installer.png` | Terminal running `get.sh` at `Paste your Gemini key ... or press Enter to skip:` |

While taking them, check the click words in the README's key guide match today's AI Studio (button names move).
Then tick box 2.

**Box 1 is open: not verified.** "Zero to talking using only the README" needs a fresh Mac, a real Google
account and key, a mic and a person talking. The steps are written from the real installer, doctor and app
code, but nobody has followed them end to end yet. Do it once (ideally someone new to the project), fix any
step that trips them, then tick box 1 and set Status to done.
