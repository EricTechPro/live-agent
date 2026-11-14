# Voice: manual check (ticket 08)

The fast tests cover LiveKit start/stop, tokens, the bridge (real LiveKit, fake model)
and voice events (fake model). A real voice reply and a real interruption need a mic
and a Gemini key, so you check those by hand. About 3 minutes.

## You need

- `livekit-server` on PATH (`brew install livekit`)
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in `.env`
- Headphones, so the agent doesn't hear itself and interrupt itself

## Steps

1. `bun run start`. You should see:
   - stdout, one line: `{"type":"ready","url":"http://127.0.0.1:...","launchToken":"..."}`
   - stderr: `live-agent: voice check page: http://127.0.0.1:.../check#...`
2. Open the check page URL in Chrome. Press **Start** and allow the mic.
3. **Spoken reply:** say "Hi, who are you?". You should hear a reply within about a second,
   and the log shows `you: ...` then `agent: ...` lines, then `{"type":"turn.done",...}`.
4. **Interruption:** ask "Tell me a long story about the sea." While it talks, say
   "Stop, stop." The voice should stop at once, and the log shows `-- interrupted --`.
5. **Same events as text:** in a second terminal, send a typed turn
   (use the URL and token from step 1):
   ```sh
   curl -s -X POST "$URL/text" -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"text":"Say hi in three words."}'
   ```
   The page log shows the same kinds of lines (`you:`, `agent:`, `turn.done`) for it.
6. **Only short-lived tokens:** in DevTools > Network, check `/session`. It returns
   only `livekitUrl, room, identity, token, expiresAt`. Nothing starts with `AIza`.
7. **Stops on exit:** press Ctrl+C in the first terminal, then run
   `curl -s http://127.0.0.1:7880`. It should fail (connection refused).
   Also try `kill -9 <pid>` on a run: LiveKit should still go away within about 2 seconds.

If step 3 fails, check stderr for `Gemini Live closed: ...`. A 404 means the API version
pin is wrong; `401/403` means the key or the ephemeral token was refused.
