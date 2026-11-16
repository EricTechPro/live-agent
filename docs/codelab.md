# DevFest codelab

The order for the room. Demo first, inside last. About an hour.

1. **Live demo (5 min).** Watch it talk, answer from the sample brain, take a "remember this",
   and start a helper while it keeps talking.
2. **Setup (15 min).** [Get your Gemini key](gemini-key.md), run the one-line
   [install](install.md), let the doctor pass, click through the setup wizard, then say hello.
3. **Customise (10 min).** Open `live-agent.config.json`. Try each [safety mode](config.md#safety-modes)
   with <kbd>Shift</kbd>+<kbd>Tab</kbd>, add a [per-tool override](config.md#per-tool-overrides), restart.
4. **Build your brain (10 min).** Add a page to `wiki/` and a project to `projects/`, ask about
   them, watch **Notes used**. Say "remember this", then find the note in `raw/`. Or point
   `brainPath` at your own notes ([bring-your-brain](../skills/bring-your-brain/SKILL.md)).
5. **Connect tools and real uses (10 min).** Ask it to read a file, start a Gemini CLI helper
   on a small project, cancel a job. Then add your own tool with the
   [add-a-tool](../skills/add-a-tool/SKILL.md) skill.
6. **How it works inside (10 min).** Gemini Live, LiveKit, NON_BLOCKING tools and ephemeral
   tokens: [How it works inside](how-it-works.md).

## The kit

Copy these into your own projects:

- [`prompts/`](../prompts/README.md): the real prompts the agent sends to Gemini (tidy, chat
  summary). The code reads them from these files.
- [`skills/`](../skills/README.md): skills for coding agents, like adding a tool or bringing your
  own brain.
- [`tools/`](../tools): every tool the agent can call, one small file each, with "why" comments.
- [`sample-brain/`](../sample-brain/README.md): the shape of a brain.
