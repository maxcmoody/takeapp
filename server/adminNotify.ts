import { fetchWithTimeout, withSentryOutbound } from "./outbound";
import { Sentry } from "./sentry";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RESEND_TIMEOUT_MS = 8_000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

interface NotifyReportPayload {
  type: "report";
  reason: string;
  message?: string | null;
  placeId: string;
  placeName?: string;
  userId: string;
  userEmail?: string | null;
  createdAt: string;
}

interface NotifyDeletionPayload {
  type: "deletion";
  message?: string | null;
  userId: string;
  userEmail?: string | null;
  createdAt: string;
}

type NotifyPayload = NotifyReportPayload | NotifyDeletionPayload;

export async function sendAdminNotification(payload: NotifyPayload): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;

  if (!resendKey) {
    console.warn("[adminNotify] RESEND_API_KEY not configured — skipping email notification");
    return;
  }
  if (!adminEmail) {
    console.warn("[adminNotify] ADMIN_NOTIFY_EMAIL not configured — skipping email notification");
    return;
  }

  if (!checkRateLimit(payload.userId)) {
    console.warn(`[adminNotify] Rate limit exceeded for user ${payload.userId} — skipping email`);
    return;
  }

  const appUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPL_SLUG
      ? `https://${process.env.REPL_SLUG}.replit.app`
      : "https://take.replit.app";

  const fromAddress = process.env.NOTIFY_FROM_EMAIL || "TAKE <onboarding@resend.dev>";
  const cc = process.env.ADMIN_NOTIFY_EMAIL_CC || undefined;

  let subject: string;
  let body: string;

  if (payload.type === "report") {
    subject = "[TAKE] New Report";
    body = [
      "A new restaurant report has been submitted.",
      "",
      `Reason: ${payload.reason}`,
      payload.message ? `Message: ${payload.message}` : null,
      `Place ID: ${payload.placeId}`,
      payload.placeName ? `Place Name: ${payload.placeName}` : null,
      `User ID: ${payload.userId}`,
      payload.userEmail ? `User Email: ${payload.userEmail}` : null,
      `Created At: ${payload.createdAt}`,
      "",
      `Review in admin: ${appUrl}/admin`,
    ].filter(Boolean).join("\n");
  } else {
    subject = "[TAKE] Data Deletion Request";
    body = [
      "A new data deletion request has been submitted.",
      "",
      payload.message ? `Message: ${payload.message}` : null,
      `User ID: ${payload.userId}`,
      payload.userEmail ? `User Email: ${payload.userEmail}` : null,
      `Created At: ${payload.createdAt}`,
      "",
      `Review in admin: ${appUrl}/admin`,
    ].filter(Boolean).join("\n");
  }

  try {
    await withSentryOutbound("resend_email", "https://api.resend.com/emails", RESEND_TIMEOUT_MS, async () => {
      const res = await fetchWithTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [adminEmail],
          ...(cc ? { cc: [cc] } : {}),
          subject,
          text: body,
        }),
      }, RESEND_TIMEOUT_MS);
      if (!res.ok) {
        const errText = await res.text();
        console.error(`[adminNotify] Resend API error (${res.status}):`, errText);
      }
    });
  } catch (err) {
    console.error("[adminNotify] Failed to send email:", err);
    Sentry.captureException(err, { tags: { "take.outbound": "resend_email" } });
  }
}

export function sendAdminNotificationAsync(payload: NotifyPayload): void {
  setImmediate(() => {
    sendAdminNotification(payload).catch((err) => {
      console.error("[adminNotify] Async notification failed:", err);
      Sentry.captureException(err, { tags: { "take.outbound": "resend_email_async" } });
    });
  });
}
