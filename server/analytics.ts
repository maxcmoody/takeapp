import { db } from "./db";
import { analyticsEvents } from "@shared/schema";

const ALLOWED_EVENTS = new Set([
  "login_success",
  "ranking_session_start",
  "ranking_session_complete",
  "place_add_selected_count",
  "share_top9",
  "group_create",
  "group_join",
]);

export async function trackEvent(
  eventName: string,
  userId?: string | null,
  properties?: Record<string, unknown>
): Promise<void> {
  if (!ALLOWED_EVENTS.has(eventName)) return;

  try {
    await db.insert(analyticsEvents).values({
      eventName,
      userId: userId || null,
      properties: properties || null,
    });
  } catch (err) {
    // fire-and-forget — never block the request
  }
}
