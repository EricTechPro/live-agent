# Install in detail

Short version: [README](../README.md#install-and-get-your-key).

macOS on Apple Silicon. In Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/EricTechPro/live-agent/main/get.sh | bash
```

Have your Gemini key ready (next section): the installer asks for it. It then:

1. downloads the ready-built app (no Rust, no build) into `/Applications` (or `~/Applications`),
2. makes a `live-agent` folder on your Desktop with the sample brain,
3. saves your key in that folder, readable only by you,
4. runs the doctor check (key, microphone, LiveKit, helper CLIs),
5. opens the app, which starts the **setup wizard**.

Your Desktop folder `~/Desktop/live-agent`:

| file | what it is |
|---|---|
| `sample-brain/` | the brain the app reads and writes (`raw`, `wiki`, `projects`) |
| `live-agent.config.json` | your settings, written by the setup wizard |
| `.env` | your Gemini key (`GEMINI_API_KEY=...`), readable only by you |

Then:

1. **Allow the microphone** when macOS asks. The reason it shows: "live-agent listens to your
   voice so you can talk to it."
2. **Click through the setup wizard.** Jett's voice, your Gemini key (if not saved yet), the
   mic, your notes folder (sample notes, or your own folder: it maps your folders onto raw,
   wiki and projects), how Jett talks (Short, Casual, Friendly, Professional) and how careful
   it is. Then say hi to test the voice. It saves `live-agent.config.json`, and the new
   settings are in use straight away.
3. **Press Start talking** and say "What is my sourdough starter called?" It answers from
   the sample brain, and the bottom bar shows `Notes used wiki/sourdough-starter.md`.
   Use headphones so it doesn't hear itself.

Run the same command again to upgrade. It never touches your brain, config or key.
The app is not notarized; `curl` downloads don't get the quarantine flag, so macOS opens it.
After an upgrade macOS may ask for the mic again (each build has a new signature).
