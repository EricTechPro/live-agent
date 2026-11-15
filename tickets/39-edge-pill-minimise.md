# 39: minimise to an edge pill, and a New chat you can find

**What to build:** The owner tried the ticket 38 dot on his Mac: a tiny faint circle, hard to find and not good looking. Replace it with a slim vertical pill docked flush on a side edge of the screen, the pattern dictation apps use (our own look, no borrowed assets). Dark glass with our teal accent and a shadow, clear on light and dark wallpapers. Top to bottom: a small state dot in the look's colour, a few mini level bars (flat at rest, your mic level while listening, Jett's level while speaking, a slow sweep while thinking), and an expand chevron. It docks on the right edge a little above centre (35% from the top, so it sits clear of another app's pill at the vertical centre), drags up and down the edge or across to the left edge, always re-docks flush to the nearest side, and remembers where it is. Under the cursor (from the poll, so it works while another app is in front) it widens a little and shows quick actions: expand, the mic (start a call, or mute / unmute) and a red hang up in a call. Clicking the pill brings the orb back where it was. Push to talk works without expanding; the pill shows the listening state. Plus: the owner could not find how to start a new conversation.

**Blocked by:** 38 v3 polish

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Minimised is a slim vertical pill (about 28 x 112 px) docked flush to the right or left screen edge; the faint dot is gone
- [ ] First minimise puts it on the right edge, its centre 35% from the top; a remembered ticket-38 dot spot moves over to the pill (nearest side edge, level with the dot); pure tested functions
- [ ] Dragging moves it freely; dropped, it re-docks flush to the nearer side edge, kept on screen top to bottom; the spot is remembered; pure tested function
- [ ] Inside, top to bottom: a state dot in the look's colour, five mini level bars and an expand chevron; the bars come from a pure tested function: flat at rest, ended, offline and muted (dimmed), the mic level while listening (flat while quiet), Jett's level while speaking, a slow sweep while thinking or connecting, nothing moves over time with reduced motion
- [ ] Under the cursor (overlay poll, not DOM hover) it widens and shows quick actions on the screen side away from the edge: expand, mic (Start call / Mute / Unmute) and a red Hang up in a call; the hover zone grows to cover the actions so moving onto them keeps them open; pure tested functions for the actions and the zone
- [ ] Clicking the pill body or its chevron brings the orb back at its last spot; Ctrl+Option+S and the menu-bar item toggle orb and pill; an approval request brings the orb back
- [ ] Holding Ctrl+Option while minimised talks without expanding, and the pill shows listening
- [ ] Orb to pill and back animate in about 200 ms (shrink and slide to the edge); instant with prefers-reduced-motion
- [ ] New chat is easy to reach: a menu-bar "New chat" item, a new-chat button among the orb's hover buttons (tooltip "New chat" with ⌘N), ⌘N while Jett has focus, and a line on the Shortcuts card
- [ ] Starting a new chat clears the captions and the drawing and shows a short "New chat" toast by the orb (zh: "新对话")
- [ ] Hand check in the real app: pill on a light and a dark wallpaper next to the other app's pill, drag along and across, hover actions from another app, push to talk while minimised, the animation, New chat from the menu bar, the orb button and ⌘N

## Comments
