import "./sentry";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { Sentry } from "./sentry";
import { setupClerkAuth } from "./clerkAuth";
import { setupClerkProxy } from "./clerkProxy";

process.on("unhandledRejection", (reason: any) => {
  console.error("[process] Unhandled rejection:", reason);
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    tags: { "take.process": "unhandledRejection" },
  });
});

process.on("uncaughtException", (err: Error) => {
  console.error("[process] Uncaught exception:", err);
  Sentry.captureException(err, {
    tags: { "take.process": "uncaughtException" },
  });
  Sentry.flush(2000).finally(() => process.exit(1));
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req: any, _res, next) => {
  Sentry.getCurrentScope().setTag("take.route", `${req.method} ${req.path}`);
  const userId = req.user?.claims?.sub;
  if (userId) {
    Sentry.getCurrentScope().setTag("take.user", userId);
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Health check endpoint — must be before Clerk middleware
  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

  // Clerk proxy — must be before setupClerkAuth so these routes are not auth-protected
  setupClerkProxy(app);

  // Setup Clerk auth middleware
  setupClerkAuth(app);

  const { seedDatabase } = await import("./seed");
  await seedDatabase().catch(e => console.error("Seed error:", e));

  const { enrichExistingTags } = await import("./enrichTags");
  await enrichExistingTags().catch(e => console.error("Tag enrichment error:", e));

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    Sentry.captureException(err);
    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
