import type { Express, Request, Response } from "express";
  import { fetchWithTimeout } from "./outbound";

  const CLERK_ORIGIN = "https://clerk.takelist.app";

  /**
   * Proxy Clerk API calls so mobile/non-browser clients can bypass domain restrictions.
   * The mobile app sets ClerkProvider proxyUrl="https://take-moodymc.replit.app/api/clerk",
   * which routes all Clerk auth requests through the backend (an allowed domain for Clerk).
   *
   * MUST be registered BEFORE setupClerkAuth() in server/index.ts.
   */
  export function setupClerkProxy(app: Express) {
    // Handle CORS preflight
    app.options("/api/clerk/*", (_req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Clerk-Auth-Token");
      res.status(204).send();
    });

    app.all("/api/clerk/*", async (req: Request, res: Response) => {
      try {
        const clerkPath = req.path.replace(/^\/api\/clerk/, "");
        const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
        const targetUrl = `${CLERK_ORIGIN}${clerkPath}${qs}`;

        const forwardHeaders: Record<string, string> = {};
        if (req.headers["content-type"]) {
          forwardHeaders["Content-Type"] = req.headers["content-type"] as string;
        }
        if (req.headers["authorization"]) {
          forwardHeaders["Authorization"] = req.headers["authorization"] as string;
        }
        if (req.headers["x-clerk-auth-token"]) {
          forwardHeaders["X-Clerk-Auth-Token"] = req.headers["x-clerk-auth-token"] as string;
        }
        if (req.headers["cookie"]) {
          forwardHeaders["Cookie"] = req.headers["cookie"] as string;
        }

        const hasBody =
          req.method !== "GET" &&
          req.method !== "HEAD" &&
          req.body != null &&
          Object.keys(req.body).length > 0;

        const response = await fetchWithTimeout(
          targetUrl,
          {
            method: req.method,
            headers: forwardHeaders,
            body: hasBody ? JSON.stringify(req.body) : undefined,
          },
          15_000,
        );

        // Forward response headers (cookies, cache-control, etc.) — skip hop-by-hop headers
        response.headers.forEach((value, name) => {
          const skip = ["transfer-encoding", "connection", "content-encoding"];
          if (!skip.includes(name.toLowerCase())) {
            res.setHeader(name, value);
          }
        });

        // Allow cross-origin access from the mobile app / Replit preview
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Clerk-Auth-Token");

        const text = await response.text();
        res.status(response.status).send(text);
      } catch (err) {
        console.error("[clerkProxy] Error proxying to Clerk:", err);
        res.status(502).json({ error: "Clerk proxy unavailable" });
      }
    });
  }
  