# Pause Bot

A multi-user Telegram bot that reminds people to perform healthcare activities on a schedule.

## Language

**User**:
A person who chats with the bot in a private chat; each Telegram identity is one User. Reminders are sent only in that private chat, not in groups.
_Avoid_: Account, customer, member

**Activity**:
A healthcare practice the bot can prompt someone to do. For a given User an Activity is either on (Reminders may fire) or off (Reminders suppressed; settings kept). Each Activity has its own Interval; Eye Rest and Stretch Break ship today.
_Avoid_: Habit, task, chore, exercise (too sport-specific)

**Eye Rest**:
The first Activity: a periodic break from near-screen focus. Interval is every 20 minutes inside the Active Window. Each Reminder instructs the classic 20-20-20 pause (look ~20 feet / 6m away for 20 seconds).
_Avoid_: Using "20-20-20" as the Activity's name in the model (fine in User-facing copy)

**Stretch Break**:
The second Activity: a periodic stand-and-stretch prompt. Interval defaults to every 60 minutes inside the Active Window. Reminders offer the same Done and Snooze as Eye Rest.
_Avoid_: Workout, exercise (too heavy), pause (already the product name)

**Active Window**:
The daily time range during which Reminders may fire for a User; shared across all of that User's Activities. The weekday window applies Monday–Friday; an optional weekend window (Saturday–Sunday) applies otherwise, defaulting to the same hours. Start and end are on the same local calendar day (end after start); ranges must not cross midnight.
_Avoid_: Configured time, schedule hours, work hours (unless we later mean work specifically)

**Interval**:
How often a Reminder fires for one Activity while inside the Active Window (for eye rest V1: every 20 minutes). The grid starts at Active Window open; a fire time must still fall inside the window.
_Avoid_: Frequency, cadence (unless we need a more abstract term later)

**Reminder**:
A prompt the bot sends a User that it is time to perform an Activity. A Reminder may offer Done and Snooze. Only the latest Reminder for an Activity is actionable; older ones are superseded.
_Avoid_: Notification, alert, ping (implementation-flavored)

**Done**:
A User action on the latest Reminder meaning they finished (or at least closed out) that prompt. Does not change when the next Reminder may fire.
_Avoid_: Complete, confirm, acknowledge, check-off

**Snooze**:
A User action on the latest Reminder that delays the next fire by a fixed short offset (for Eye Rest: 5 minutes). Delay-only: while a Snooze is pending, the normal Interval grid does not fire for that Activity; if the delayed fire would fall outside the Active Window, the Snooze is dropped. After the snoozed fire (or drop), the from-window-open grid resumes. The User may Snooze again on a snoozed Reminder (chain until the window ends). A pending Snooze is cleared if the User turns the Activity off, changes Active Window or Timezone, or deletes their data.
_Avoid_: Postpone, reschedule, delay (as the product noun)

**Timezone**:
A User's local timezone as an IANA zone (e.g. Asia/Jakarta); Active Windows are interpreted in this timezone. Shared across all of that User's Activities.
_Avoid_: UTC offset alone (offsets ignore DST)
