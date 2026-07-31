# Immediate schedule recompute on config change

When a User changes Active Window or Timezone, the Reminder grid recomputes immediately in local time—not at next midnight. That matches “settings mean now,” avoids stale pings after a shorter window, and accepts a slightly more careful scheduler over a simpler next-day switch.
