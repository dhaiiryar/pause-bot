import type { UserFromGetMe } from "grammy/types";

/** Minimal botInfo for Grammy unit tests (no real Telegram). */
export const testBotInfo = {
  id: 1,
  is_bot: true,
  first_name: "PauseTest",
  username: "pause_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
} as UserFromGetMe;

export function okResult<T>(result: T): { ok: true; result: T } {
  return { ok: true, result };
}
