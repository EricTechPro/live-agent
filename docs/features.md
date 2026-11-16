# What it is

The full feature list. Short version: [README](../README.md).

A small desktop app you talk to.

- **It talks back in real time.** Gemini Live hears, thinks and speaks in one model. You can
  interrupt it mid-sentence.
- **It knows your notes.** It reads a **second brain** folder (`raw`, `wiki`, `projects`) and
  shows which notes each answer used. It ships with a made-up sample brain so it works on day one.
- **It learns slowly.** After a chat it saves a short note, and a background job tidies new
  notes into clean wiki pages.
- **It hands off big jobs.** "Fix the bug in my recipe app" starts a **helper agent**
  (Gemini CLI, Codex or Claude Code) in the background. A job board shows its progress, and
  the voice tells you when it is done. It never freezes while a tool runs. With worktrees on,
  a finished job's changes are committed on its own branch for you to review.
- **It draws.** "Draw how the voice gets to Gemini" sketches on the Canvas tab while the
  voice talks: hand-drawn boxes, arrows and Mermaid diagram cards, each beat's strokes timed
  to the line being said (`draw`). "Make p2 red" or "clear the board" changes it (`edit_canvas`).
- **It sees your screen.** "What's this?" takes one screenshot when asked (`look`), finds a
  thing on screen (`find_on_screen`) and rings it for you (`mark_screen`). Nothing is captured
  until it looks.
- **It reads your files.** "Read notes/today.md" opens a file for it (`read_file`).
- **It shrinks out of the way.** The **Mini** button turns the window into a small
  always-on-top orb that shows how many jobs are running. Voice keeps working; click the orb
  to open the full window again.
- **You decide what it may do alone.** Three safety modes, Ask me / Auto edits / Bypass.
  <kbd>Shift</kbd>+<kbd>Tab</kbd> switches them.
- **One JSON file controls it all**, and a click-through setup wizard fills it in for you.

All you need is a Gemini key. LiveKit (the part that carries your voice) runs on your own
computer, inside the app. No accounts, no cloud servers.
