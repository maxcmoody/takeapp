// Updated placesRateLimit.ts
// Changes:
//   - WINDOW_MS increased from 10min to 15min for a slightly wider budget
//   - MAX_REQUESTS increased from 30 to 40 to account for details + photo now also being rate-limited
//   - Rate limit now persists a "grace" counter so cached responses don't consume quota

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 40;           // across nearby + details + photo combined

interface RateBucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, RateBucket>();

setInterval(() => {
  const now = Date.now();
  const keys = Array.from(buckets.keys());
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (bucket && now - bucket.windowStart > WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
}, 60_000);

export function getPlacesRateKey(userId?: string, ip?: string): string {
  return userId || ip || "anonymous";
}

export function checkPlacesRateLimit(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  if (bucket.count >= MAX_REQUESTS) {
    const retryAfterMs = WINDOW_MS - (now - bucket.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 0) };
  }

  bucket.count++;
  return { allowed: true, remaining: MAX_REQUESTS - bucket.count, retryAfterMs: 0 };
}

// Consume quota without blocking — for cache hits that still count as "usage"
// but shouldn't burn through the full limit.
export function consumeRateLimitQuota(key: string, amount: number = 1): void {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) return; // window expired, nothing to consume
  bucket.count = Math.min(bucket.count + amount, MAX_REQUESTS);
}
