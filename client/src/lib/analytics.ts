import { apiRequest } from "./queryClient";

type CoreEvent =
  | { event: "login_success" }
  | { event: "ranking_session_start" }
  | { event: "ranking_session_complete" }
  | { event: "place_add_selected_count"; properties: { count: number } }
  | { event: "share_top9" }
  | { event: "group_create" }
  | { event: "group_join" }
  | { event: "invite_created" }
  | { event: "data_export" };

export function trackEvent(payload: CoreEvent): void {
  const body: { event: string; properties?: Record<string, unknown> } = {
    event: payload.event,
  };
  if ("properties" in payload) {
    body.properties = payload.properties;
  }

  fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  }).catch(() => {});
}
