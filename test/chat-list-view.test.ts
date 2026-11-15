// Ticket 24, window side: the sidebar's past chats as rows with a calm relative date. Pure.
import { expect, test } from "bun:test";
import { chatRows, refreshesChats, relativeDate } from "../app/src/chat-list.ts";

const now = new Date(2026, 10, 15, 15, 0); // Sun 15 Nov 2026, 3 pm

test("relative dates: now, minutes, hours, days, then the day", () => {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  expect(relativeDate(ago(20_000), now)).toBe("now");
  expect(relativeDate(ago(5 * 60_000), now)).toBe("5m");
  expect(relativeDate(ago(3 * 3_600_000), now)).toBe("3h");
  expect(relativeDate(new Date(2026, 10, 14, 23, 0).toISOString(), now)).toBe("1d");
  expect(relativeDate(new Date(2026, 10, 11, 9, 0).toISOString(), now)).toBe("4d");
  expect(relativeDate(new Date(2026, 9, 2, 9, 0).toISOString(), now)).toBe("2 Oct");
  expect(relativeDate(new Date(2025, 9, 2, 9, 0).toISOString(), now)).toBe("2 Oct 2025");
  expect(relativeDate("not a date", now)).toBe("");
});

test("rows keep the core's order and add the relative date", () => {
  const rows = chatRows(
    [
      { path: "raw/2026-11-15-chat.md", title: "Dentist", date: new Date(2026, 10, 15, 14, 0).toISOString() },
      { path: "raw/2026-11-14-chat.md", title: "Gus", date: new Date(2026, 10, 14, 10, 0).toISOString() },
    ],
    now,
  );
  expect(rows).toEqual([
    { path: "raw/2026-11-15-chat.md", title: "Dentist", when: "1h" },
    { path: "raw/2026-11-14-chat.md", title: "Gus", when: "1d" },
  ]);
});

test("the list refreshes when a chat's note is saved and the next chat starts, or the brain changes", () => {
  expect(refreshesChats({ type: "chat.started" })).toBe(true);
  expect(refreshesChats({ type: "brain.write", path: "raw/x.md", cause: "chat-end" })).toBe(true);
  expect(refreshesChats({ type: "setup.saved" } as never)).toBe(true);
  expect(refreshesChats({ type: "brain.write", path: "raw/x.md", cause: "tool", tool: "remember" })).toBe(false);
});
