# Get your Gemini key

Short version: [README](../README.md#install-and-get-your-key).

The key is how Google knows the requests are yours. One key runs everything: the voice, the
tidy job and the Gemini CLI helper. It takes about two minutes.

1. **Open Google AI Studio.** Go to <https://aistudio.google.com/apikey> and sign in with your
   Google account.

2. **Accept the terms** (first visit only). Tick the box to agree to the Gemini API terms and
   press **Continue**.

3. **Find the API keys page.** You land on **API keys**. New accounts often already have one
   key in a default project. If you see a key in the list, skip to step 5.

4. **Create a key.** Press **Create API key**. In the dialog, give the key a name (for example
   `live-agent`), pick a project or press **Create project**, then press **Create key**.

5. **Copy the key.** Click the key in the list, then press **Copy**. It is a long string that
   starts with `AQ.` (new auth keys, the default since May 2026) or `AIza` (older keys). Both work.

6. **Paste it into the installer.** When the installer says `Paste your Gemini key`, paste
   and press <kbd>Enter</kbd>. Nothing shows while you paste; that is on purpose.

**Skipped it?** No problem: the app opens on **Paste your Gemini key**. Paste it there and press
**Save and start**. The app checks the key with Google, saves it in `~/Desktop/live-agent/.env`
(readable only by you) and goes straight into the setup wizard. The window never shows it again.

**Got a new key?** Open the key file and put the key after `GEMINI_API_KEY=`:

```sh
open -e ~/Desktop/live-agent/.env      # GEMINI_API_KEY=AQ.... (or AIza...)
```

Then quit and reopen the app. Check it with the [doctor](config.md#doctor): `✓ Gemini key: key works`.

Keep the key secret: never paste it into a chat, a screenshot or a git repo. If it leaks,
delete it on the same page and make a new one. The free tier is enough to try live-agent;
Google may ask you to turn on billing for heavier use.
