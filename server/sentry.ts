import * as Sentry from "@sentry/node";
import { execSync } from "child_process";

let commitSha = "unknown";
try {
  commitSha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
} catch {}

const buildTime = new Date().toISOString();

export const RELEASE_VERSION = `take@${commitSha}`;
export const BUILD_TIME = buildTime;
export const COMMIT_SHA = commitSha;

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    release: RELEASE_VERSION,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.2,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
    integrations: [],
  });
}

export { Sentry };
