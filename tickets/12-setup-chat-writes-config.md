# 12: Setup chat writes the config

**What to build:** On first launch, a short setup chat (spoken or typed) asks a few questions: brain folder, safety mode, which helpers to turn on, max helpers at once. It writes the config file. It can be run again later.

**Blocked by:** 03 Config file, 09 Desktop window: orb, transcript, talk out loud

**Status:** ready-for-agent

**Priority:** must-have

- [ ] First launch with no config starts the setup chat
- [ ] Answers are saved to a config that passes the schema
- [ ] Skipping a question keeps the default
- [ ] Running setup again updates the existing config instead of wiping it
