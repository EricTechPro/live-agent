# 19: Paste your key in the window

**What to build:** When the app starts with no Gemini key, the window shows a "Paste your Gemini key" screen instead of an error. It links to https://aistudio.google.com/apikey. The core checks the key works, saves it to `.env` in the live-agent folder (readable only by you), starts up, and goes straight into the setup chat. The key passes through the window once, when pasted, and is never stored or shown there again. The installer's terminal prompt stays, but is optional. Found in Eric's first real install: run without a keyboard, the installer skipped the key and the app opened on "Core did not start: no Gemini key".

**Blocked by:** 12 Setup chat writes the config, 13 One-command install

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Opening the app with no key shows the paste-your-key screen, not an error
- [ ] A bad key is refused with a plain message, and nothing is saved
- [ ] A good key is saved with only-you permissions, and the app moves on to the setup chat without a restart
- [ ] The key never comes back to the window and is never written to a log
- [ ] The installer run with no keyboard ends with the app open on the key screen
