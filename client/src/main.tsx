import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: `take@client`,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
    integrations: [Sentry.browserTracingIntegration()],
  });
}

async function fetchWithRetry(url: string, retries = 3, delay = 500): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch (e) {
      if (i === retries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

async function init() {
  let publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (import.meta.env.DEV) {
    try {
      const res = await fetchWithRetry("/api/clerk-config");
      const data = await res.json();
      if (data.publishableKey) {
        publishableKey = data.publishableKey;
      }
    } catch (e) {
      console.error("Failed to fetch clerk config from server:", e);
    }

    if (publishableKey && !publishableKey.startsWith("pk_test_")) {
      console.error("Clerk: Refusing to use production key in development. Set CLERK_DEV_PUBLISHABLE_KEY in secrets.");
      publishableKey = null;
    }
  }

  if (!publishableKey) {
    throw new Error("Missing Clerk publishable key");
  }

  createRoot(document.getElementById("root")!).render(
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  );
}

init();
