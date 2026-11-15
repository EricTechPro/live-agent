# 28: Inline approve / deny card for "May I…?"

**What to build:** When the safety gate says `ask`, the window shows an approve / deny card next to the composer naming the tool and what it will do, in plain words (for helpers: which helper, task, folder). Approve or Deny does the same as a spoken yes or no (today only a spoken yes works, `src/core/approvals.ts:20`). The core gets one new way in: approve or decline a pending call by id (a POST endpoint next to job cancel in `src/app.ts:326`). The card goes away when the call is answered either way, by voice or by click.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** ready-for-agent

**Priority:** must-have

- [ ] A `safety.verdict` of `ask` shows an approve / deny card by the composer
- [ ] Approve runs the call: the event stream shows the `allow` verdict and the tool result, like a spoken yes (scripted fake model test)
- [ ] Deny declines it: the model hears it was declined, like a spoken no (scripted fake model test)
- [ ] Answering by voice removes the card; clicking after it was already answered does nothing
- [ ] Unknown or already-answered call ids are refused by the core endpoint
- [ ] The card's buttons are icons with tooltips, keyboard reachable, and Enter does not approve by default

## Comments
