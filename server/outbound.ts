import { Sentry } from "./sentry";

const DEFAULT_TIMEOUT_MS = 10_000;

export class FetchTimeoutError extends Error {
  public readonly url: string;
  public readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number) {
    super(`Fetch timeout after ${timeoutMs}ms: ${url}`);
    this.name = "FetchTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err: any) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function withSentryOutbound<T>(
  name: string,
  url: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  Sentry.addBreadcrumb({
    category: "outbound",
    message: name,
    data: { url: url.split("?")[0], timeoutMs },
    level: "info",
  });

  Sentry.getCurrentScope().setTag("take.outbound", name);
  try {
    return await fn();
  } catch (err) {
    Sentry.captureException(err, { tags: { "take.outbound": name } });
    throw err;
  } finally {
    Sentry.getCurrentScope().setTag("take.outbound", undefined as any);
  }
}
