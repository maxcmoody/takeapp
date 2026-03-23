import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { insertRestaurantSchema, restaurants, type VenueBucket } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { applyChainBias, buildNameCountMap, type BiasMode } from "./chainBias";
import { getLeaderboard, getHiddenGems, getGroupLeaderboard, rescaleTakeScore, getAreaMeta } from "./leaderboard";
import { getGoogleTypesForTag } from "./tagMapping";
import { isAuthenticated } from "./clerkAuth";
import { SEED_RESTAURANTS, SEED_RANKINGS } from "./seedData";
import { encodeGeohash } from "@shared/geohash";
import { startSession, getActiveSession, processVote, cancelSession } from "./rankingSession";
import { buildNearbyCacheKey, buildCategoryCacheKey, buildViewportCacheKey, getTtlForEndpoint, getCachedPayload, setCachedPayload, dedupeByPlaceId, capResults, maybeCleanupCache, MAX_RESULTS, normalizeNameForDedup, namesMatchFuzzy } from "./placesCache";
import { getPlacesRateKey, checkPlacesRateLimit } from "./placesRateLimit";
import { trackEvent } from "./analytics";
import { RELEASE_VERSION, COMMIT_SHA, BUILD_TIME, Sentry } from "./sentry";
import { sendAdminNotificationAsync } from "./adminNotify";
import { fetchWithTimeout, withSentryOutbound, FetchTimeoutError } from "./outbound";

const PLACES_CACHE = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const apiCounters = { nearby: 0, details: 0, photo: 0, detailsBgRefresh: 0, newApiTypes: 0, autocomplete: 0 };
const cacheHitCounters = { detailsMem: 0, detailsDb: 0, detailsMiss: 0, photoMem: 0, photoDb: 0, photoMiss: 0, nearbyDb: 0, nearbyMiss: 0, autocompleteMem: 0, autocompleteMiss: 0 };
const counterStartedAt = Date.now();

const detailsInFlight = new Map<string, Promise<any>>();

const AUTOCOMPLETE_CACHE = new Map<string, { data: any; timestamp: number }>();
const AUTOCOMPLETE_CACHE_TTL = 60 * 1000; // 60 seconds
const AUTOCOMPLETE_CACHE_MAX = 500;

function getAutocompleteCache(key: string): any | undefined {
  const entry = AUTOCOMPLETE_CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > AUTOCOMPLETE_CACHE_TTL) {
    AUTOCOMPLETE_CACHE.delete(key);
    return undefined;
  }
  return entry.data;
}

function setAutocompleteCache(key: string, data: any): void {
  if (AUTOCOMPLETE_CACHE.size >= AUTOCOMPLETE_CACHE_MAX) {
    const firstKey = AUTOCOMPLETE_CACHE.keys().next().value;
    if (firstKey) AUTOCOMPLETE_CACHE.delete(firstKey);
  }
  AUTOCOMPLETE_CACHE.set(key, { data, timestamp: Date.now() });
}

import crypto from "crypto";

function generateInviteCode(): string {
  return crypto.randomBytes(6).toString('base64url');
}

function spearmanCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const rank = (arr: number[]) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  const rx = rank(x);
  const ry = rank(y);
  let dSq = 0;
  for (let i = 0; i < n; i++) dSq += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * dSq) / (n * (n * n - 1));
}

const NEW_API_DETAILS_FIELD_MASK = "id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,location,types,primaryType,photos,priceLevel,rating,userRatingCount,shortFormattedAddress";

function mapNewPriceLevel(pl: string | undefined): number | undefined {
  if (!pl) return undefined;
  const m: Record<string, number> = {
    PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return m[pl];
}

function newPlaceToLegacyResult(p: any): any {
  const photoRef = p.photos?.[0]?.name || null;
  return {
    place_id: p.id,
    name: p.displayName?.text || "",
    formatted_address: p.formattedAddress || "",
    vicinity: p.shortFormattedAddress || p.formattedAddress || "",
    formatted_phone_number: p.nationalPhoneNumber || "",
    website: p.websiteUri || "",
    geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
    types: p.types || [],
    primaryType: p.primaryType || null,
    photos: (() => {
      const seen = new Set<string>();
      return (p.photos || []).reduce((acc: any[], ph: any) => {
        if (ph.name && !seen.has(ph.name)) {
          seen.add(ph.name);
          acc.push({ photo_reference: ph.name });
        }
        return acc;
      }, []);
    })(),
    price_level: mapNewPriceLevel(p.priceLevel),
    rating: p.rating,
    user_ratings_total: p.userRatingCount || 0,
    photo_reference: photoRef,
    lat: p.location?.latitude || null,
    lng: p.location?.longitude || null,
  };
}

function newPlaceToLegacyDetails(p: any): any {
  return {
    status: "OK",
    result: {
      place_id: p.id,
      name: p.displayName?.text || "",
      formatted_address: p.formattedAddress || "",
      formatted_phone_number: p.nationalPhoneNumber || "",
      website: p.websiteUri || "",
      geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
      types: p.types || [],
      photos: (() => {
        const seen = new Set<string>();
        return (p.photos || []).reduce((acc: any[], ph: any) => {
          if (ph.name && !seen.has(ph.name)) {
            seen.add(ph.name);
            acc.push({ photo_reference: ph.name, width: ph.widthPx, height: ph.heightPx });
          }
          return acc;
        }, []);
      })(),
      price_level: mapNewPriceLevel(p.priceLevel),
      rating: p.rating,
      user_ratings_total: p.userRatingCount || 0,
    },
  };
}

async function callNewPlaceDetails(placeId: string, apiKey: string, fieldMask?: string): Promise<any> {
  const mask = fieldMask || NEW_API_DETAILS_FIELD_MASK;
  const response = await fetchWithTimeout(
    `https://places.googleapis.com/v1/places/${placeId}`,
    { headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': mask } },
    10_000,
  );
  return response.json();
}

async function callNewNearbySearch(lat: number, lng: number, radius: number, apiKey: string, opts: { type?: string; keyword?: string; maxResults?: number } = {}): Promise<any> {
  const fieldMask = "places.id,places.displayName,places.shortFormattedAddress,places.formattedAddress,places.location,places.types,places.primaryType,places.photos,places.priceLevel,places.rating,places.userRatingCount";

  if (opts.keyword) {
    const body: any = {
      textQuery: `${opts.keyword} restaurant`,
      locationBias: {
        circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radius, 50000) },
      },
      maxResultCount: opts.maxResults || 20,
      rankPreference: "RELEVANCE",
    };
    if (opts.type) {
      body.includedType = opts.type;
    }
    const response = await fetchWithTimeout(
      `https://places.googleapis.com/v1/places:searchText`,
      {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
      },
      10_000,
    );
    return response.json();
  }

  const body: any = {
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radius, 50000) },
    },
    maxResultCount: opts.maxResults || 20,
    rankPreference: "POPULARITY",
  };
  if (opts.type) {
    body.includedTypes = [opts.type];
  }
  const response = await fetchWithTimeout(
    `https://places.googleapis.com/v1/places:searchNearby`,
    {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    },
    10_000,
  );
  return response.json();
}

async function callNewAutocomplete(input: string, apiKey: string, opts: { lat?: number; lng?: number; radius?: number; types?: string[]; sessionToken?: string } = {}): Promise<any> {
  const body: any = { input };
  if (opts.lat !== undefined && opts.lng !== undefined) {
    body.locationBias = {
      circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: opts.radius || 50000 },
    };
  }
  if (opts.types && opts.types.length > 0) {
    body.includedPrimaryTypes = opts.types;
  }
  if (opts.sessionToken) {
    body.sessionToken = opts.sessionToken;
  }
  const response = await fetchWithTimeout(
    `https://places.googleapis.com/v1/places:autocomplete`,
    {
      method: "POST",
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify(body),
    },
    10_000,
  );
  return response.json();
}

async function callNewTextSearch(query: string, apiKey: string, fieldMask?: string): Promise<any> {
  const mask = fieldMask || "places.id,places.photos";
  const response = await fetchWithTimeout(
    `https://places.googleapis.com/v1/places:searchText`,
    {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': mask,
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    },
    10_000,
  );
  return response.json();
}

const bgRefreshInFlight = new Set<string>();

async function refreshPlaceDetailsInBackground(placeId: string, apiKey: string): Promise<void> {
  if (bgRefreshInFlight.has(placeId)) return;
  bgRefreshInFlight.add(placeId);
  try {
    apiCounters.detailsBgRefresh++;
    const rawData = await callNewPlaceDetails(placeId, apiKey);
    if (rawData.error) {
      console.log(`[bg-refresh] API error for ${placeId}: ${rawData.error.message}`);
      return;
    }
    const data = newPlaceToLegacyDetails(rawData);
    const photoReference = data.result?.photos?.[0]?.photo_reference || null;
    await storage.cachePlaceDetails(placeId, JSON.stringify(data), photoReference);
    PLACES_CACHE.set(placeId, { data, timestamp: Date.now() });

    const types = rawData.types as string[] | undefined;
    const primaryType = rawData.primaryType || null;
    if (types && types.length > 0) {
      storage.backfillGoogleTypes(placeId, types, primaryType).catch(() => {});
    }
    console.log(`[bg-refresh] Updated stale details for ${placeId}`);
  } catch (err) {
    console.log(`[bg-refresh] Failed for ${placeId}:`, (err as any)?.message);
  } finally {
    bgRefreshInFlight.delete(placeId);
  }
}

async function fetchNewApiTypes(placeId: string, apiKey: string): Promise<void> {
  try {
    apiCounters.newApiTypes++;
    const data = await callNewPlaceDetails(placeId, apiKey, "types,primaryType");
    if (data.types && data.types.length > 0) {
      const primaryType = data.primaryType || data.types[0] || null;
      await storage.backfillGoogleTypes(placeId, data.types, primaryType);
    }
  } catch (err) {
    // silently fail
  }
}

const CHATTANOOGA_LAT = 35.0456;
const CHATTANOOGA_LNG = -85.3097;
const SEARCH_RADIUS = 50000; // ~31 miles

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), version: RELEASE_VERSION });
  });

  app.get("/api/health/places", async (_req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.json({ ok: false, error: "no_api_key" });
    try {
      const data = await callNewNearbySearch(CHATTANOOGA_LAT, CHATTANOOGA_LNG, 1000, apiKey, { type: "restaurant", maxResults: 5 });
      const ok = !data.error && Array.isArray(data.places);
      res.json({ ok, status: ok ? "OK" : "ERROR", resultCount: (data.places || []).length });
    } catch (err: any) {
      res.json({ ok: false, error: err instanceof FetchTimeoutError ? "timeout" : err.message });
    }
  });

  app.get("/api/version", (_req, res) => {
    res.json({ version: RELEASE_VERSION, commit: COMMIT_SHA, buildTime: BUILD_TIME });
  });

  app.get("/api/clerk-config", (_req, res) => {
    const isDev = process.env.NODE_ENV !== "production";
    const publishableKey = (isDev && process.env.CLERK_DEV_PUBLISHABLE_KEY)
      ? process.env.CLERK_DEV_PUBLISHABLE_KEY
      : process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || "";
    res.json({ publishableKey });
  });

  app.get("/api/admin/api-counters", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    const isAdmin = userId === process.env.ADMIN_USER_ID;
    if (!isAdmin) return res.status(403).json({ error: "Forbidden" });
    const uptimeMs = Date.now() - counterStartedAt;
    const uptimeMin = Math.round(uptimeMs / 60000);
    res.json({
      counters: { ...apiCounters },
      total: apiCounters.nearby + apiCounters.details + apiCounters.photo + apiCounters.detailsBgRefresh + apiCounters.newApiTypes + apiCounters.autocomplete,
      uptimeMinutes: uptimeMin,
      cacheHits: { ...cacheHitCounters },
      cacheStats: {
        placesCache: PLACES_CACHE.size,
        autocompleteCache: AUTOCOMPLETE_CACHE.size,
        detailsInFlight: detailsInFlight.size,
        bgRefreshInFlight: bgRefreshInFlight.size,
      },
    });
  });

  app.get("/api/sentry-test", async (req: any, res) => {
    const adminKey = process.env.ADMIN_TEST_KEY;
    const queryKey = req.query.key as string | undefined;
    const isAuthed = req.isAuthenticated?.() && req.user?.claims?.sub;
    const keyMatch = adminKey && queryKey === adminKey;
    if (!isAuthed && !keyMatch) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    Sentry.captureMessage("TAKE backend test");
    try {
      throw new Error("TAKE backend test exception");
    } catch (err) {
      Sentry.captureException(err);
    }
    res.json({ ok: true });
  });

  app.post("/api/analytics/event", async (req: any, res) => {
    try {
      const schema = z.object({
        event: z.string().min(1).max(100),
        properties: z.record(z.unknown()).optional(),
      });
      const { event, properties } = schema.parse(req.body);
      const userId = req.user?.claims?.sub || null;
      trackEvent(event, userId, properties);
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: "Invalid event payload" });
    }
  });

  function isAdmin(req: any): boolean {
    if (!req.isAuthenticated?.() || !req.user?.claims?.sub) return false;
    const userId = req.user.claims.sub;
    const email = req.user.claims.email;
    if (process.env.ADMIN_USER_ID && userId === process.env.ADMIN_USER_ID) return true;
    if (process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL) return true;
    return false;
  }

  app.post("/api/reports", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({
        placeId: z.string().min(1),
        reason: z.enum(["Closed", "Wrong info", "Duplicate", "Offensive", "Other"]),
        message: z.string().max(500).optional(),
      });
      const { placeId, reason, message } = schema.parse(req.body);
      const report = await storage.createReport(userId, placeId, reason, message);
      res.json(report);
      const userEmail = req.user?.claims?.email || null;
      sendAdminNotificationAsync({
        type: "report",
        reason,
        message,
        placeId,
        userId,
        userEmail,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      console.error("Create report error:", error);
      res.status(500).json({ error: "Failed to create report" });
    }
  });

  app.get("/api/reports/mine", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const reports = await storage.getReportsByUser(userId);
      res.json({ reports });
    } catch (error) {
      console.error("Get reports error:", error);
      res.status(500).json({ error: "Failed to get reports" });
    }
  });

  app.post("/api/account-deletion-request", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({ message: z.string().max(500).optional() });
      const { message } = schema.parse(req.body);
      const request = await storage.createDeletionRequest(userId, message);
      res.json(request);
      const userEmail = req.user?.claims?.email || null;
      sendAdminNotificationAsync({
        type: "deletion",
        message,
        userId,
        userEmail,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Deletion request error:", error);
      res.status(500).json({ error: "Failed to create deletion request" });
    }
  });

  app.get("/api/admin/reports", isAuthenticated, async (req: any, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const reports = await storage.getOpenReports(limit, offset);
      res.json({ reports });
    } catch (error) {
      console.error("Admin reports error:", error);
      res.status(500).json({ error: "Failed to get reports" });
    }
  });

  app.post("/api/admin/reports/:id/resolve", isAuthenticated, async (req: any, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    try {
      await storage.resolveReport(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Resolve report error:", error);
      res.status(500).json({ error: "Failed to resolve report" });
    }
  });

  app.get("/api/admin/deletion-requests", isAuthenticated, async (req: any, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const requests = await storage.getOpenDeletionRequests(limit, offset);
      res.json({ requests });
    } catch (error) {
      console.error("Admin deletion requests error:", error);
      res.status(500).json({ error: "Failed to get deletion requests" });
    }
  });

  app.post("/api/admin/deletion-requests/:id/resolve", isAuthenticated, async (req: any, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    try {
      await storage.resolveDeletionRequest(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Resolve deletion request error:", error);
      res.status(500).json({ error: "Failed to resolve deletion request" });
    }
  });

  app.get("/api/me", isAuthenticated, async (req: any, res) => {
    const claims = req.user?.claims;
    if (!claims?.sub) return res.status(401).json({ error: "Not authenticated" });
    res.json({
      id: claims.sub,
      email: claims.email || null,
      firstName: claims.first_name || claims.given_name || null,
      lastName: claims.last_name || claims.family_name || null,
      isAdmin: isAdmin(req),
    });
  });

  app.patch("/api/me/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { firstName, lastName } = req.body;
      if (typeof firstName !== "string" && typeof lastName !== "string") {
        return res.status(400).json({ error: "Provide firstName or lastName" });
      }
      const data: { firstName?: string; lastName?: string } = {};
      if (typeof firstName === "string") data.firstName = firstName.trim().slice(0, 100);
      if (typeof lastName === "string") data.lastName = lastName.trim().slice(0, 100);
      const user = await storage.updateUserProfile(userId, data);
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json({ ok: true, user: { id: user.id, firstName: user.firstName, lastName: user.lastName } });
    } catch (e: any) {
      console.error("Update profile error:", e);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.get("/api/admin/check", isAuthenticated, async (req: any, res) => {
    res.json({ isAdmin: isAdmin(req) });
  });

  app.get("/api/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      const rankings = await storage.getUserRankings(userId);
      const groups = await storage.getGroupsByUserId(userId);
      const matchupCount = await storage.getUserMatchupCount(userId);
      const sessionsSummary = await storage.getUserSessionsSummary(userId);

      const exportData = {
        user: {
          id: userId,
          email: user?.email || null,
          createdAt: user?.createdAt || null,
        },
        myTake: rankings.map((r, i) => ({
          rankIndex: r.rankPosition,
          restaurantId: r.restaurant.id,
          name: r.restaurant.name,
          googlePlaceId: r.restaurant.googlePlaceId || null,
        })),
        comparisons: {
          totalMatchups: matchupCount,
        },
        rankingSessions: sessionsSummary,
        groups: groups.map(g => ({
          id: g.id,
          name: g.name,
          role: g.role,
          memberCount: g.memberCount,
        })),
        metadata: {
          exportTime: new Date().toISOString(),
          appVersion: RELEASE_VERSION || "unknown",
          buildTime: BUILD_TIME || null,
        },
      };
      res.json(exportData);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  app.get("/api/account-deletion-request/mine", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const requests = await storage.getDeletionRequestsByUser(userId);
      const latest = requests[0] || null;
      res.json({ request: latest });
    } catch (error) {
      console.error("Get deletion request error:", error);
      res.status(500).json({ error: "Failed to get deletion request" });
    }
  });

  app.post("/api/admin/deletion-requests/:id/complete", isAuthenticated, async (req: any, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    try {
      const reqRecord = await storage.getDeletionRequestById(req.params.id);
      if (!reqRecord) return res.status(404).json({ error: "Not found" });
      if (reqRecord.status === "resolved" || reqRecord.status === "completed") return res.status(400).json({ error: "Already resolved" });
      await storage.anonymizeUser(reqRecord.userId);
      await storage.completeDeletionRequest(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Complete deletion error:", error);
      res.status(500).json({ error: "Failed to complete deletion" });
    }
  });

  app.get("/api/places/autocomplete", async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API key is missing or misconfigured. Contact the app administrator." });
    }

    const { input, sessiontoken } = req.query;
    if (!input) {
      return res.status(400).json({ error: "Missing input parameter" });
    }

    try {
      const userLat = req.query.lat ? parseFloat(req.query.lat as string) : CHATTANOOGA_LAT;
      const userLng = req.query.lng ? parseFloat(req.query.lng as string) : CHATTANOOGA_LNG;

      const acCacheKey = `ac:${(input as string).toLowerCase().trim()}:${userLat.toFixed(2)}:${userLng.toFixed(2)}`;
      const cachedAc = getAutocompleteCache(acCacheKey);
      if (cachedAc) {
        cacheHitCounters.autocompleteMem++;
        return res.json(cachedAc);
      }

      cacheHitCounters.autocompleteMiss++;
      apiCounters.autocomplete++;
      if (process.env.ENABLE_DEV_FAULTS === "true" && req.query.simulate === "places_timeout") {
        return res.status(502).json({ error: "places_timeout", simulated: true });
      }
      const rawData = await callNewAutocomplete(input as string, apiKey, {
        lat: userLat, lng: userLng, radius: SEARCH_RADIUS,
        types: ["restaurant", "bar", "cafe", "bakery", "night_club"],
        sessionToken: sessiontoken as string | undefined,
      });

      if (rawData.error) {
        console.error("Places API error:", rawData.error.message);
        return res.status(500).json({ 
          error: "Google Places API error. The API key may be invalid or the Places API is not enabled.", 
          message: rawData.error.message 
        });
      }

      const predictions = (rawData.suggestions || [])
        .filter((s: any) => s.placePrediction)
        .map((s: any) => {
          const pp = s.placePrediction;
          return {
            place_id: pp.placeId || pp.place?.id,
            description: pp.text?.text || pp.structuredFormat?.mainText?.text || "",
            structured_formatting: {
              main_text: pp.structuredFormat?.mainText?.text || "",
              secondary_text: pp.structuredFormat?.secondaryText?.text || "",
            },
            types: pp.types || [],
          };
        });

      const data = { status: "OK", predictions };
      setAutocompleteCache(acCacheKey, data);

      res.json(data);
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        console.error("Places Autocomplete Timeout:", error.message);
        return res.status(502).json({ error: "places_timeout" });
      }
      console.error("Places Autocomplete Error:", error);
      res.status(500).json({ error: "Failed to fetch suggestions" });
    }
  });

  app.get("/api/places/details", async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API key is missing or misconfigured. Contact the app administrator." });
    }

    const { place_id, sessiontoken } = req.query;
    if (!place_id || typeof place_id !== 'string') {
      return res.status(400).json({ error: "Missing place_id parameter" });
    }
    const detailsUserId = (req as any).user?.claims?.sub;
    const detailsRateKey = getPlacesRateKey(detailsUserId, req.ip);
    const detailsRateCheck = checkPlacesRateLimit(detailsRateKey);
    if (!detailsRateCheck.allowed) {
      const memCached = PLACES_CACHE.get(place_id);
      if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
        return res.json(memCached.data);
      }
      try {
        const dbCached = await storage.getCachedPlaceDetails(place_id);
        if (dbCached) {
          const parsed = JSON.parse(dbCached.detailsJson);
          PLACES_CACHE.set(place_id, { data: parsed, timestamp: Date.now() });
          return res.json(parsed);
        }
      } catch {}
      return res.status(429).json({
        error: "Too many requests. Please wait before loading more details.",
        retryAfterMs: detailsRateCheck.retryAfterMs,
      });
    }

    const cached = PLACES_CACHE.get(place_id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      cacheHitCounters.detailsMem++;
      return res.json(cached.data);
    }

    try {
      const dbCached = await storage.getCachedPlaceDetails(place_id);
      if (dbCached) {
        cacheHitCounters.detailsDb++;
        const parsedData = JSON.parse(dbCached.detailsJson);
        PLACES_CACHE.set(place_id, { data: parsedData, timestamp: Date.now() });
        res.json(parsedData);

        if (dbCached.isStale) {
          refreshPlaceDetailsInBackground(place_id, apiKey);
        }
        return;
      }
    } catch (err) {
      console.log(`[cache] DB cache lookup failed for ${place_id}:`, (err as any)?.message);
    }

    cacheHitCounters.detailsMiss++;
    let inFlight = detailsInFlight.get(place_id);
    if (!inFlight) {
      inFlight = (async () => {
        try {
          apiCounters.details++;
          const rawData = await callNewPlaceDetails(place_id as string, apiKey);

          if (rawData.error) {
            return { status: "REQUEST_DENIED", error_message: rawData.error.message };
          }

          const data = newPlaceToLegacyDetails(rawData);
          PLACES_CACHE.set(place_id, { data, timestamp: Date.now() });

          const photoReference = data.result?.photos?.[0]?.photo_reference || null;
          storage.cachePlaceDetails(place_id, JSON.stringify(data), photoReference)
            .catch(err => console.log(`[cache] DB cache save failed for ${place_id}:`, (err as any)?.message));

          const types = rawData.types as string[] | undefined;
          const primaryType = rawData.primaryType || null;
          if (types && types.length > 0) {
            storage.backfillGoogleTypes(place_id, types, primaryType)
              .catch(err => console.log(`[backfill] Types backfill for ${place_id}:`, err?.message));
          }

          return data;
        } finally {
          detailsInFlight.delete(place_id);
        }
      })();
      detailsInFlight.set(place_id, inFlight);
    }

    try {
      if (process.env.ENABLE_DEV_FAULTS === "true" && req.query.simulate === "places_timeout") {
        return res.status(502).json({ error: "places_timeout", simulated: true });
      }
      const data = await inFlight;

      if (data.status === 'REQUEST_DENIED') {
        console.error("Places Details API denied:", data.error_message);
        return res.status(500).json({ 
          error: "Google Places API error. The API key may be invalid or the Places API is not enabled.",
          message: data.error_message
        });
      }
      
      res.json(data);
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        const cached = PLACES_CACHE.get(place_id as string);
        if (cached) return res.json(cached.data);
        return res.status(502).json({ error: "places_timeout" });
      }
      console.error("Places Details Error:", error);
      res.status(500).json({ error: "Failed to fetch place details" });
    }
  });

  const PHOTO_CACHE = new Map<string, { buffer: Buffer; contentType: string; timestamp: number }>();
  const PHOTO_CACHE_TTL = 24 * 60 * 60 * 1000;
  const PHOTO_CACHE_MAX = 500;
  const photoInFlight = new Map<string, Promise<{ buffer: Buffer; contentType: string } | null>>();

  function evictOldPhotos() {
    if (PHOTO_CACHE.size <= PHOTO_CACHE_MAX) return;
    const now = Date.now();
    const keys = Array.from(PHOTO_CACHE.keys());
    for (const key of keys) {
      const entry = PHOTO_CACHE.get(key);
      if (!entry || now - entry.timestamp > PHOTO_CACHE_TTL || PHOTO_CACHE.size > PHOTO_CACHE_MAX) {
        PHOTO_CACHE.delete(key);
      }
    }
  }

  async function resolvePhotoUrl(ref: string, apiKey: string, placeId?: string): Promise<string | null> {
    if (ref.startsWith("places/")) {
      return `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=400&key=${apiKey}`;
    }
    if (placeId) {
      return `https://places.googleapis.com/v1/places/${placeId}/photos/${ref}/media?maxWidthPx=400&key=${apiKey}`;
    }
    // Without a placeId we cannot reliably resolve the photo URL.
    // The previous LIKE substring fallback could match the wrong restaurant,
    // causing multiple restaurants to display the same thumbnail.
    return null;
  }

  async function fetchPhotoFromGoogle(ref: string, apiKey: string, placeId?: string, photoIndex?: number): Promise<{ buffer: Buffer; contentType: string } | null> {
    const existing = photoInFlight.get(ref);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const dbPhoto = await storage.getPhotoFromCache(ref, placeId);
        if (dbPhoto) {
          cacheHitCounters.photoDb++;
          PHOTO_CACHE.set(ref, { buffer: dbPhoto.data, contentType: dbPhoto.contentType, timestamp: Date.now() });
          return { buffer: dbPhoto.data, contentType: dbPhoto.contentType };
        }

        apiCounters.photo++;
        const photoUrl = await resolvePhotoUrl(ref, apiKey, placeId);
        if (!photoUrl) {
          return null;
        }
        const response = await fetchWithTimeout(
          photoUrl,
          { redirect: 'follow' },
          10_000,
        );
        if (response.ok) {
          const contentType = response.headers.get('content-type') || 'image/jpeg';
          const buffer = Buffer.from(await response.arrayBuffer());
          PHOTO_CACHE.set(ref, { buffer, contentType, timestamp: Date.now() });
          evictOldPhotos();
          
          if (placeId && (!photoIndex || photoIndex === 0)) {
            storage.savePhotoToCache(placeId, buffer, contentType).catch(e => console.error("Failed to save photo to DB:", e));
          }
          
          return { buffer, contentType };
        }
        if (!response.ok && placeId) {
          try {
            const details = await callNewPlaceDetails(placeId, apiKey, "photos");
            const allPhotos = details.photos || [];
            const targetIndex = (typeof photoIndex === 'number' && photoIndex >= 0 && photoIndex < allPhotos.length) ? photoIndex : 0;
            const ordered = [allPhotos[targetIndex], ...allPhotos.filter((_: any, idx: number) => idx !== targetIndex)].filter(Boolean);
            for (const ph of ordered) {
              const phName = ph.name || "";
              if (!phName) continue;
              const freshUrl = phName.startsWith("places/")
                ? `https://places.googleapis.com/v1/${phName}/media?maxWidthPx=400&key=${apiKey}`
                : `https://places.googleapis.com/v1/places/${placeId}/photos/${phName}/media?maxWidthPx=400&key=${apiKey}`;
              const freshResp = await fetchWithTimeout(freshUrl, { redirect: 'follow' }, 10_000);
              if (freshResp.ok) {
                const contentType = freshResp.headers.get('content-type') || 'image/jpeg';
                const buffer = Buffer.from(await freshResp.arrayBuffer());
                PHOTO_CACHE.set(ref, { buffer, contentType, timestamp: Date.now() });
                evictOldPhotos();
                if (!photoIndex || photoIndex === 0) {
                  storage.savePhotoToCache(placeId, buffer, contentType).catch(() => {});
                }
                return { buffer, contentType };
              }
            }
          } catch {}
        }
        return null;
      } catch {
        return null;
      } finally {
        photoInFlight.delete(ref);
      }
    })();

    photoInFlight.set(ref, promise);
    return promise;
  }

  app.get("/api/places/photo", async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API key is missing or misconfigured. Contact the app administrator." });
    }

    const { ref, placeId, photoIndex } = req.query;
    if (!ref || typeof ref !== 'string') {
      return res.status(400).json({ error: "Missing ref parameter" });
    }
    const photoUserId = (req as any).user?.claims?.sub;
    const photoRateKey = getPlacesRateKey(photoUserId, req.ip);
    const photoRateCheck = checkPlacesRateLimit(photoRateKey);
    if (!photoRateCheck.allowed) {
      const memPhoto = PHOTO_CACHE.get(ref);
      if (memPhoto && Date.now() - memPhoto.timestamp < PHOTO_CACHE_TTL) {
        res.setHeader('Content-Type', memPhoto.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(memPhoto.buffer);
      }
      try {
        const dbPhoto = await storage.getPhotoFromCache(ref, placeId as string | undefined);
        if (dbPhoto) {
          res.setHeader('Content-Type', dbPhoto.contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(dbPhoto.data);
        }
      } catch {}
      return res.status(429).json({
        error: "Too many requests. Please wait before loading more photos.",
        retryAfterMs: photoRateCheck.retryAfterMs,
      });
    }

    const cached = PHOTO_CACHE.get(ref);
    if (cached && Date.now() - cached.timestamp < PHOTO_CACHE_TTL) {
      cacheHitCounters.photoMem++;
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cached.buffer);
    }

    try {
      const parsedIndex = photoIndex ? parseInt(photoIndex as string, 10) : undefined;
      const result = await fetchPhotoFromGoogle(ref, apiKey, placeId as string, isNaN(parsedIndex as number) ? undefined : parsedIndex);
      if (result) {
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(result.buffer);
      }

      cacheHitCounters.photoMiss++;
      res.status(404).json({ error: "Photo not found" });
    } catch (error) {
      console.error("Photo proxy error:", error);
      res.status(500).json({ error: "Failed to fetch photo" });
    }
  });

  app.get("/api/places/area-autocomplete", async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API key is missing or misconfigured. Contact the app administrator." });
    }

    const { input } = req.query;
    if (!input) {
      return res.status(400).json({ error: "Missing input parameter" });
    }

    const areaCacheKey = `area:${(input as string).toLowerCase().trim()}`;
    const cachedArea = getAutocompleteCache(areaCacheKey);
    if (cachedArea) {
      return res.json(cachedArea);
    }

    try {
      if (process.env.ENABLE_DEV_FAULTS === "true" && req.query.simulate === "places_timeout") {
        return res.status(502).json({ error: "places_timeout", simulated: true });
      }
      apiCounters.autocomplete++;
      const rawData = await callNewAutocomplete(input as string, apiKey, {
        types: ["locality", "sublocality", "postal_code", "administrative_area_level_1", "administrative_area_level_2", "country"],
      });

      if (rawData.error) {
        return res.status(500).json({ error: "Google Places API error. The API key may be invalid or the Places API is not enabled.", message: rawData.error.message });
      }

      const predictions = (rawData.suggestions || [])
        .filter((s: any) => s.placePrediction)
        .map((s: any) => {
          const pp = s.placePrediction;
          return {
            place_id: pp.placeId || pp.place?.id,
            description: pp.text?.text || "",
            structured_formatting: {
              main_text: pp.structuredFormat?.mainText?.text || "",
              secondary_text: pp.structuredFormat?.secondaryText?.text || "",
            },
            types: pp.types || [],
          };
        });

      const data = { status: "OK", predictions };
      setAutocompleteCache(areaCacheKey, data);

      res.json(data);
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        return res.status(502).json({ error: "places_timeout" });
      }
      console.error("Area Autocomplete Error:", error);
      res.status(500).json({ error: "Failed to fetch area suggestions" });
    }
  });

  app.get("/api/places/nearby", async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API key is missing or misconfigured. Contact the app administrator." });
    }

    const { lat, lng, radius: radiusParam, page_token, exclude, biasChains, chainPenaltyStrength, rankedCount, keyword: tagKeyword } = req.query;
    const searchLat = lat ? parseFloat(lat as string) : CHATTANOOGA_LAT;
    const searchLng = lng ? parseFloat(lng as string) : CHATTANOOGA_LNG;
    const searchRadius = radiusParam
      ? Math.min(Math.max(Math.round(parseFloat(radiusParam as string)), 500), 100000)
      : 15000;
    const excludeSet = new Set(
      exclude ? (exclude as string).split(',').filter(Boolean) : []
    );

    const userId = (req as any).user?.claims?.sub;
    const rateKey = getPlacesRateKey(userId, req.ip);
    const rateCheck = checkPlacesRateLimit(rateKey);

    const isViewport = !!(req.query.viewport === "true" || req.query.viewport === "1");
    const endpointType = isViewport ? "viewport" as const : "nearby" as const;
    const cacheKeyTag = tagKeyword ? (tagKeyword as string) : undefined;
    const dbCacheKey = isViewport
      ? buildViewportCacheKey(searchLat, searchLng, searchRadius, cacheKeyTag)
      : buildNearbyCacheKey(searchLat, searchLng, searchRadius, page_token as string | undefined, cacheKeyTag);
    const ttl = getTtlForEndpoint(endpointType);

    maybeCleanupCache();

    const includeTakeRanked = !page_token;
    let takeRankedResults: any[] = [];
    if (includeTakeRanked) {
      try {
        const takeLeaderboard = await getLeaderboard({
          centerLat: searchLat,
          centerLng: searchLng,
          radiusKm: Math.max(5, Math.min(searchRadius / 1000, 120)),
          limit: 50,
        });
        takeRankedResults = takeLeaderboard
          .filter((e: any) => e.googlePlaceId && !excludeSet.has(e.googlePlaceId))
          .map((e: any) => {
            let photoRef: string | undefined;
            if (e.image) {
              const refMatch = e.image.match(/[?&]ref=([^&]+)/);
              photoRef = refMatch ? decodeURIComponent(refMatch[1]) : e.image;
            }
            return {
              place_id: e.googlePlaceId,
              name: e.name,
              vicinity: e.location || "",
              types: e.googleTypes || [],
              geometry: (e.lat != null && e.lng != null) ? { location: { lat: e.lat, lng: e.lng } } : undefined,
              rating: e.avgRank ? Math.round(e.avgRank * 50) / 10 : undefined,
              price_level: e.priceLevel ? parseInt(e.priceLevel) : undefined,
              take_score: rescaleTakeScore(e.score),
              take_appearances: e.appearances,
              photo_reference: photoRef,
              photos: photoRef ? [{ photo_reference: photoRef }] : [],
            };
          });
      } catch {
        takeRankedResults = [];
      }
    }
    const takePlaceIdSet = new Set(takeRankedResults.map((p: any) => p.place_id));
    const takeNormalizedNames = takeRankedResults.map((p: any) => normalizeNameForDedup(p.name || "")).filter(n => n.length >= 3);
    const takeNameSet = new Set(takeNormalizedNames);
    const isInTakeSet = (p: any) => {
      if (takePlaceIdSet.has(p.place_id)) return true;
      const norm = normalizeNameForDedup(p.name || "");
      if (norm.length < 3) return false;
      if (takeNameSet.has(norm)) return true;
      for (let i = 0; i < takeNormalizedNames.length; i++) {
        if (namesMatchFuzzy(norm, takeNormalizedNames[i])) return true;
      }
      return false;
    };

    if (!rateCheck.allowed) {
      const stalePayload = await getCachedPayload(dbCacheKey, true);
      if (stalePayload) {
        let staleResults = stalePayload.results || [];
        if (includeTakeRanked && takeRankedResults.length > 0) {
          const staleFiltered = staleResults.filter((p: any) => !isInTakeSet(p));
          staleResults = [...takeRankedResults, ...staleFiltered];
        }
        return res.json({ ...stalePayload, results: capResults(dedupeByPlaceId(staleResults)), _cached: true, _rateLimited: true });
      }
      if (takeRankedResults.length > 0) {
        return res.json({ results: takeRankedResults, next_page_token: null, _takeOnly: true, _rateLimited: true });
      }
      return res.status(429).json({ error: "Too many requests. Please wait a moment before searching again.", retryAfterMs: rateCheck.retryAfterMs });
    }

    const biasMode = (["auto", "off", "strong"].includes(biasChains as string) ? biasChains : "auto") as BiasMode;
    const penaltyStrength = chainPenaltyStrength ? parseFloat(chainPenaltyStrength as string) : undefined;
    const userRankedCount = rankedCount ? parseInt(rankedCount as string, 10) : 0;

    const cached = await getCachedPayload(dbCacheKey);
    if (cached) {
      cacheHitCounters.nearbyDb++;
      let filtered = cached.results
        .filter((p: any) => !excludeSet.has(p.place_id))
        .filter((p: any) => p.take_score || (p.rating && p.rating >= 3.5 && (p.user_ratings_total || 0) >= 30));
      const nameCountMap = buildNameCountMap(filtered);
      filtered = applyChainBias(filtered, {
        rankedCount: userRankedCount,
        biasMode,
        chainPenaltyStrength: penaltyStrength,
        nameCountMap,
      });
      const mergedResults = includeTakeRanked
        ? [
            ...takeRankedResults,
            ...filtered.filter((p: any) => !isInTakeSet(p)),
          ]
        : filtered;
      return res.json({ ...cached, results: capResults(dedupeByPlaceId(mergedResults)), _cached: true });
    }

    cacheHitCounters.nearbyMiss++;
    try {
      if (process.env.ENABLE_DEV_FAULTS === "true" && req.query.simulate === "places_timeout") {
        const stale = await getCachedPayload(dbCacheKey, true);
        if (stale) return res.status(200).json({ ...stale, _cached: true, _simulated: true });
        return res.status(502).json({ error: "places_timeout", simulated: true });
      }

      if (page_token) {
        return res.json({ results: [], next_page_token: null });
      }

      apiCounters.nearby++;
      const rawData = await callNewNearbySearch(searchLat, searchLng, searchRadius, apiKey, {
        type: "restaurant",
        keyword: tagKeyword as string | undefined,
        maxResults: 20,
      });

      if (rawData.error) {
        console.error("Places Nearby API error:", rawData.error.message);
        return res.status(500).json({
          error: "Google Places API error. The API key may be invalid or the Places API is not enabled.",
          message: rawData.error.message
        });
      }

      const allRawResults = (rawData.places || []).map(newPlaceToLegacyResult);

      const results = allRawResults
        .filter((p: any) => p.rating && p.rating >= 3.5 && (p.user_ratings_total || 0) >= 30)
        .sort((a: any, b: any) => (b.rating * Math.log(b.user_ratings_total || 1)) - (a.rating * Math.log(a.user_ratings_total || 1)))
        .map((p: any) => ({
          place_id: p.place_id,
          name: p.name,
          vicinity: p.vicinity,
          rating: p.rating,
          user_ratings_total: p.user_ratings_total,
          price_level: p.price_level,
          types: p.types,
          photo_reference: p.photo_reference || null,
          lat: p.lat || null,
          lng: p.lng || null,
        }));

      const cachePayload = { results, next_page_token: null };
      setCachedPayload(dbCacheKey, cachePayload, ttl);

      for (const p of results) {
        if (p.place_id && p.types?.length > 0) {
          storage.backfillGoogleTypes(p.place_id, p.types, p.types[0] || null)
            .catch(() => {});
        }
      }

      let filtered = results.filter(
        (p: any) => !excludeSet.has(p.place_id)
      );
      const nameCountMap = buildNameCountMap(filtered);
      filtered = applyChainBias(filtered, {
        rankedCount: userRankedCount,
        biasMode,
        chainPenaltyStrength: penaltyStrength,
        nameCountMap,
      });
      const mergedResults = includeTakeRanked
        ? [
            ...takeRankedResults,
            ...filtered.filter((p: any) => !isInTakeSet(p)),
          ]
        : filtered;
      res.json({ results: capResults(dedupeByPlaceId(mergedResults)), next_page_token: nextPageToken });
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        const stale = await getCachedPayload(dbCacheKey, true);
        if (stale) return res.json({ ...stale, _cached: true, _timeout: true });
        return res.status(502).json({ error: "places_timeout" });
      }
      console.error("Places Nearby Error:", error);
      res.status(500).json({ error: "Couldn't load nearby places. Please try again." });
    }
  });

  app.get("/api/places/nearby/category", async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API key is missing or misconfigured. Contact the app administrator." });
    }

    const { lat, lng, keyword, type, biasChains, chainPenaltyStrength: catPenalty, rankedCount: catRanked } = req.query;
    const searchLat = lat ? parseFloat(lat as string) : CHATTANOOGA_LAT;
    const searchLng = lng ? parseFloat(lng as string) : CHATTANOOGA_LNG;
    const searchKeyword = keyword ? (keyword as string) : '';
    const searchType = (type as string) || 'restaurant';

    const userId = (req as any).user?.claims?.sub;
    const rateKey = getPlacesRateKey(userId, req.ip);
    const rateCheck = checkPlacesRateLimit(rateKey);

    const dbCacheKey = buildCategoryCacheKey(searchLat, searchLng, searchKeyword, searchType);
    const ttl = getTtlForEndpoint("category");

    maybeCleanupCache();

    const catBiasMode = (["auto", "off", "strong"].includes(biasChains as string) ? biasChains : "auto") as BiasMode;
    const catPenaltyStrength = catPenalty ? parseFloat(catPenalty as string) : undefined;
    const catRankedCount = catRanked ? parseInt(catRanked as string, 10) : 0;

    if (!rateCheck.allowed) {
      const stalePayload = await getCachedPayload(dbCacheKey, true);
      if (stalePayload) {
        return res.json({ ...stalePayload, _cached: true, _rateLimited: true });
      }
      return res.status(429).json({ error: "Too many requests. Please wait a moment before searching again.", retryAfterMs: rateCheck.retryAfterMs });
    }

    const cached = await getCachedPayload(dbCacheKey);
    if (cached) {
      const filtered = cached.results
        .filter((p: any) => p.rating && p.rating >= 3.5 && (p.user_ratings_total || 0) >= 30);
      const biased = applyChainBias(filtered, {
        rankedCount: catRankedCount,
        biasMode: catBiasMode,
        chainPenaltyStrength: catPenaltyStrength,
        nameCountMap: buildNameCountMap(filtered),
      });
      return res.json({ results: capResults(dedupeByPlaceId(biased)), _cached: true });
    }

    try {
      if (process.env.ENABLE_DEV_FAULTS === "true" && req.query.simulate === "places_timeout") {
        const stale = await getCachedPayload(dbCacheKey, true);
        if (stale) return res.status(200).json({ ...stale, _cached: true, _simulated: true });
        return res.status(502).json({ error: "places_timeout", simulated: true });
      }
      apiCounters.nearby++;
      const rawData = await callNewNearbySearch(searchLat, searchLng, SEARCH_RADIUS, apiKey, {
        type: searchType,
        keyword: searchKeyword,
        maxResults: 20,
      });

      if (rawData.error) {
        console.error("Places Category API error:", rawData.error.message);
        return res.status(500).json({
          error: "Google Places API error. The API key may be invalid or the Places API is not enabled.",
          message: rawData.error.message
        });
      }

      const results = (rawData.places || []).map(newPlaceToLegacyResult)
        .filter((p: any) => p.rating && p.rating >= 3.5 && (p.user_ratings_total || 0) >= 30)
        .sort((a: any, b: any) => (b.rating * Math.log(b.user_ratings_total || 1)) - (a.rating * Math.log(a.user_ratings_total || 1)))
        .slice(0, 20)
        .map((p: any) => ({
          place_id: p.place_id,
          name: p.name,
          vicinity: p.vicinity,
          rating: p.rating,
          user_ratings_total: p.user_ratings_total,
          price_level: p.price_level,
          types: p.types,
          photo_reference: p.photo_reference || null
        }));

      const cachePayload = { results };
      setCachedPayload(dbCacheKey, cachePayload, ttl);

      for (const p of results) {
        if (p.place_id && p.types?.length > 0) {
          storage.backfillGoogleTypes(p.place_id, p.types, p.types[0] || null)
            .catch(() => {});
        }
      }

      const biased = applyChainBias(results, {
        rankedCount: catRankedCount,
        biasMode: catBiasMode,
        chainPenaltyStrength: catPenaltyStrength,
        nameCountMap: buildNameCountMap(results),
      });
      res.json({ results: capResults(dedupeByPlaceId(biased)) });
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        const stale = await getCachedPayload(dbCacheKey, true);
        if (stale) return res.json({ ...stale, _cached: true, _timeout: true });
        return res.status(502).json({ error: "places_timeout" });
      }
      console.error("Places Category Error:", error);
      res.status(500).json({ error: "Couldn't load category results. Please try again." });
    }
  });

  app.get("/api/restaurants/:id", async (req, res) => {
    try {
      let restaurant = await storage.getRestaurantById(req.params.id);
      if (!restaurant) {
        restaurant = await storage.getRestaurantByPlaceId(req.params.id);
      }
      if (!restaurant) {
        return res.status(404).json({ error: "Restaurant not found" });
      }
      res.json(restaurant);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch restaurant" });
    }
  });

  app.post("/api/restaurants", async (req, res) => {
    try {
      const data = insertRestaurantSchema.parse(req.body);
      const restaurant = await storage.upsertRestaurant(data);
      res.json({ success: true, ...restaurant });
    } catch (error) {
       if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error("Create restaurant error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  });

  app.get("/api/rankings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bucket = (req.query.bucket as string) === "bar" ? "bar" as const : "restaurant" as const;
      const rows = await storage.getUserRankings(userId, bucket);
      const restaurantList = rows.map(r => ({
        id: r.restaurant.id,
        name: r.restaurant.name,
        image: r.restaurant.image,
        tags: r.restaurant.tags || [],
        location: r.restaurant.location || '',
        category: r.restaurant.category || '',
        rating: r.restaurant.rating ? Number(r.restaurant.rating) : 0,
        votes: r.restaurant.votes ? Number(r.restaurant.votes) : 0,
        priceLevel: r.restaurant.priceLevel ? Number(r.restaurant.priceLevel) : 0,
        googlePlaceId: r.restaurant.googlePlaceId || undefined,
        lat: r.restaurant.lat ?? undefined,
        lng: r.restaurant.lng ?? undefined,
        googleTypes: r.restaurant.googleTypes || [],
        googlePrimaryType: r.restaurant.googlePrimaryType || undefined,
        venueBucket: r.restaurant.venueBucket,
        isHybrid: r.restaurant.isHybrid,
      }));
      const ranking = rows.map(r => r.restaurant.id);

      let movements: Record<string, { delta: number; isNew: boolean }> = {};
      try {
        const prevSnapshot = await storage.getLatestUserRankingSnapshot(userId);
        if (prevSnapshot.length > 0) {
          const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
          const snapshotDate = prevSnapshot[0]?.snapshotDate;
          const withinWindow = snapshotDate && (Date.now() - snapshotDate.getTime()) < SEVEN_DAYS_MS;

          if (withinWindow) {
            const prevMap = new Map(prevSnapshot.map(s => [s.restaurantId, s.position]));
            for (let i = 0; i < ranking.length; i++) {
              const rId = ranking[i];
              const prevPos = prevMap.get(rId);
              if (prevPos === undefined) {
                movements[rId] = { delta: 0, isNew: true };
              } else {
                const delta = prevPos - (i + 1);
                if (delta !== 0) {
                  movements[rId] = { delta, isNew: false };
                }
              }
            }
          }
        }
      } catch (snapErr) {
        console.error('[snapshot] User ranking movement error:', (snapErr as any)?.message);
      }

      res.json({ restaurants: restaurantList, ranking, movements });
    } catch (error) {
      console.error("Error fetching rankings:", error);
      res.status(500).json({ error: "Failed to fetch rankings" });
    }
  });

  app.post("/api/rankings/sync", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({
        restaurants: z.array(z.object({
          id: z.string().optional(),
          name: z.string(),
          googlePlaceId: z.string().optional(),
          image: z.string().optional(),
          tags: z.array(z.string()).optional(),
          location: z.string().optional(),
          category: z.string().optional(),
          rating: z.string().optional(),
          priceLevel: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
        })),
        ranking: z.array(z.string()),
        bucket: z.enum(["restaurant", "bar"]).optional(),
      });

      const body = schema.parse(req.body);
      const bucket = body.bucket ?? "restaurant";
      const restaurantIdMap = new Map<string, string>();

      for (const r of body.restaurants) {
        const upserted = await storage.upsertRestaurant({
          name: r.name,
          googlePlaceId: r.googlePlaceId ?? null,
          image: r.image ?? null,
          tags: r.tags ?? null,
          location: r.location ?? null,
          category: r.category ?? null,
          rating: r.rating ?? null,
          votes: null,
          priceLevel: r.priceLevel ?? null,
          lat: r.lat ?? null,
          lng: r.lng ?? null,
        });
        if (r.id) {
          restaurantIdMap.set(r.id, upserted.id);
        }
      }

      const listLength = body.ranking.length;
      const rankings = body.ranking
        .map((clientId, index) => {
          const dbId = restaurantIdMap.get(clientId);
          if (!dbId) return null;
          return {
            restaurantId: dbId,
            rankPosition: index + 1,
            listLength,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const existingRankings = await storage.getUserRankings(userId, bucket);
      if (existingRankings.length > 0 && rankings.length < existingRankings.length) {
        const diff = existingRankings.length - rankings.length;
        const dropPercent = diff / existingRankings.length;
        if (dropPercent > 0.5 && diff > 2) {
          console.warn(`[sync-safety] User ${userId}: refusing sync that would drop ${diff} rankings (${existingRankings.length} -> ${rankings.length}, ${Math.round(dropPercent * 100)}%)`);
          return res.status(409).json({ 
            error: "Sync would lose too many rankings", 
            existing: existingRankings.length, 
            incoming: rankings.length 
          });
        }
        if (diff > 0) {
          console.warn(`[sync-safety] User ${userId}: sync dropping ${diff} rankings (${existingRankings.length} -> ${rankings.length})`);
        }
      }

      await storage.syncUserRankings(userId, rankings, bucket);

      storage.saveUserRankingSnapshot(
        userId,
        rankings.map(r => ({ restaurantId: r.restaurantId, position: r.rankPosition }))
      ).catch(err => console.error('[snapshot] User ranking snapshot error:', err?.message));

      res.json({ success: true, synced: rankings.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error("Rankings sync error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  });

  app.post("/api/rankings/repair", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({
        items: z.array(z.object({
          googlePlaceId: z.string(),
          name: z.string(),
          rankPosition: z.number(),
          image: z.string().optional(),
          tags: z.array(z.string()).optional(),
          location: z.string().optional(),
          category: z.string().optional(),
          rating: z.string().optional(),
          priceLevel: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
        })),
      });

      const body = schema.parse(req.body);
      const rankings: { restaurantId: string; rankPosition: number; listLength: number }[] = [];

      for (const item of body.items) {
        const upserted = await storage.upsertRestaurant({
          name: item.name,
          googlePlaceId: item.googlePlaceId,
          image: item.image ?? null,
          tags: item.tags ?? null,
          location: item.location ?? null,
          category: item.category ?? null,
          rating: item.rating ?? null,
          votes: null,
          priceLevel: item.priceLevel ?? null,
          lat: item.lat ?? null,
          lng: item.lng ?? null,
        });
        rankings.push({
          restaurantId: upserted.id,
          rankPosition: item.rankPosition,
          listLength: body.items.length,
        });
      }

      await storage.syncUserRankings(userId, rankings);
      res.json({ success: true, repaired: rankings.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error("Rankings repair error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  });

  function generateJoinCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  app.post("/api/groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({ name: z.string().min(1).max(100) });
      const { name } = schema.parse(req.body);
      const joinCode = generateJoinCode();
      const group = await storage.createGroup(name, userId, joinCode);
      trackEvent("group_create", userId);
      res.json(group);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create group error:", error);
      res.status(500).json({ error: "Failed to create group" });
    }
  });

  app.get("/api/groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const groups = await storage.getGroupsByUserId(userId);
      res.json({ groups });
    } catch (error) {
      console.error("List groups error:", error);
      res.status(500).json({ error: "Failed to list groups" });
    }
  });

  app.post("/api/groups/join", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({ code: z.string().min(1) });
      const { code } = schema.parse(req.body);
      const group = await storage.getGroupByJoinCode(code);
      if (!group) {
        return res.status(404).json({ error: "Invalid join code" });
      }
      const already = await storage.isGroupMember(group.id, userId);
      if (already) {
        return res.json({ group, alreadyMember: true });
      }
      await storage.addGroupMember(group.id, userId, 'member');
      trackEvent("group_join", userId);
      res.json({ group, alreadyMember: false });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Join group error:", error);
      res.status(500).json({ error: "Failed to join group" });
    }
  });

  app.get("/api/groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const groupId = req.params.id;
      const group = await storage.getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      const isMember = await storage.isGroupMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
      const members = await storage.getGroupMembers(groupId);
      res.json({ ...group, members });
    } catch (error) {
      console.error("Get group error:", error);
      res.status(500).json({ error: "Failed to get group" });
    }
  });

  app.get("/api/groups/:id/leaderboard", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const groupId = req.params.id;
      const isMember = await storage.isGroupMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
      const memberIds = await storage.getGroupMemberUserIds(groupId);
      const tag = req.query.tag as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const results = await getGroupLeaderboard({ memberUserIds: memberIds, tag, limit, offset });
      res.json({ results: results.map(r => ({ ...r, score: rescaleTakeScore(r.score) })) });
    } catch (error) {
      console.error("Group leaderboard error:", error);
      res.status(500).json({ error: "Failed to get group leaderboard" });
    }
  });

  const leaveGroupHandler = async (req: any, res: any) => {
    try {
      const userId = req.user.claims.sub;
      const groupId = req.params.id;
      const isMember = await storage.isGroupMember(groupId, userId);
      if (!isMember) {
        return res.status(404).json({ error: "Not a member" });
      }
      await storage.removeGroupMember(groupId, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Leave group error:", error);
      res.status(500).json({ error: "Failed to leave group" });
    }
  };
  app.delete("/api/groups/:id/leave", isAuthenticated, leaveGroupHandler);
  app.post("/api/groups/:id/leave", isAuthenticated, leaveGroupHandler);

  const PAIRWISE_LOGGING_ENABLED = process.env.PAIRWISE_LOGGING_ENABLED !== 'false';

  app.post("/api/matchups/log", isAuthenticated, async (req: any, res) => {
    if (!PAIRWISE_LOGGING_ENABLED) {
      return res.json({ logged: false, reason: 'disabled' });
    }

    try {
      const userId = req.user.claims.sub;
      const schema = z.object({
        winnerPlaceId: z.string().min(1),
        loserPlaceId: z.string().min(1),
        source: z.enum(['insert_binary', 'neighbor_verify', 'rerank', 'group_vote']),
        contextTag: z.string().nullable().optional(),
        sessionId: z.string().nullable().optional(),
        winnerLat: z.number().nullable().optional(),
        winnerLng: z.number().nullable().optional(),
      });

      const body = schema.parse(req.body);

      let regionGeohash: string | null = null;
      if (body.winnerLat != null && body.winnerLng != null) {
        regionGeohash = encodeGeohash(body.winnerLat, body.winnerLng, 5);
      }

      const matchup = await storage.logPairwiseMatchup({
        userId,
        winnerPlaceId: body.winnerPlaceId,
        loserPlaceId: body.loserPlaceId,
        source: body.source,
        contextTag: body.contextTag ?? null,
        regionGeohash,
        sessionId: body.sessionId ?? null,
      });

      res.json({ logged: true, id: matchup.id });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        console.error("Matchup log error:", error);
        res.status(500).json({ error: "Failed to log matchup" });
      }
    }
  });

  app.get("/api/matchups", async (req, res) => {
    if (process.env.NODE_ENV === 'production' && !req.query.admin) {
      return res.status(403).json({ error: "Dev-only endpoint" });
    }

    try {
      const { placeId, limit: limitParam } = req.query;
      if (!placeId || typeof placeId !== 'string') {
        return res.status(400).json({ error: "Missing placeId parameter" });
      }
      const limit = limitParam ? Math.min(parseInt(limitParam as string, 10), 200) : 50;
      const matchups = await storage.getMatchupsByPlaceId(placeId, limit);
      res.json({ matchups });
    } catch (error) {
      console.error("Matchup query error:", error);
      res.status(500).json({ error: "Failed to fetch matchups" });
    }
  });

  app.post("/api/admin/reseed", async (req, res) => {
    try {
      const restaurantIdMap = new Map<string, string>();
      let upsertedCount = 0;

      for (const r of SEED_RESTAURANTS) {
        const upserted = await storage.upsertRestaurant({
          name: r.name,
          googlePlaceId: r.googlePlaceId,
          image: r.image,
          tags: r.tags,
          location: r.location,
          category: r.category,
          rating: r.rating,
          votes: null,
          priceLevel: r.priceLevel,
          lat: r.lat,
          lng: r.lng,
        });
        const key = r.googlePlaceId || r.name;
        restaurantIdMap.set(key, upserted.id);
        upsertedCount++;
      }

      const seedUserIds = Array.from(new Set(SEED_RANKINGS.map(r => r.userId)));

      for (const userId of seedUserIds) {
        const userRankings = SEED_RANKINGS.filter(r => r.userId === userId);
        const dbRankings: { restaurantId: string; rankPosition: number; listLength: number }[] = [];

        for (const ranking of userRankings) {
          const key = ranking.googlePlaceId || ranking.restaurantName;
          const restaurantId = restaurantIdMap.get(key);
          if (restaurantId) {
            dbRankings.push({
              restaurantId,
              rankPosition: ranking.rankPosition,
              listLength: ranking.listLength,
            });
          } else {
            console.warn(`Reseed: could not find restaurant for key="${key}"`);
          }
        }

        if (dbRankings.length > 0) {
          await storage.syncUserRankings(userId, dbRankings);
        }
      }

      res.json({
        success: true,
        restaurants: upsertedCount,
        seedUsers: seedUserIds.length,
        rankings: SEED_RANKINGS.length,
      });
    } catch (error) {
      console.error("Reseed error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.delete("/api/rankings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.deleteUserRankings(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting rankings:", error);
      res.status(500).json({ error: "Failed to delete rankings" });
    }
  });

  app.get("/api/maps-key", (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.json({ key: null });
    }
    res.json({ key: apiKey });
  });

  app.get("/api/leaderboard", async (req, res) => {
    try {
      const { lat, lng, radius, tag, price, limit, offset } = req.query;

      const centerLat = lat ? parseFloat(lat as string) : CHATTANOOGA_LAT;
      const centerLng = lng ? parseFloat(lng as string) : CHATTANOOGA_LNG;
      const radiusKm = radius ? parseFloat(radius as string) : undefined;
      const priceLevel = price ? (price as string).split(',').map(Number).filter(n => !isNaN(n)) : undefined;
      const limitNum = limit ? parseInt(limit as string, 10) : undefined;
      const offsetNum = offset ? parseInt(offset as string, 10) : undefined;

      const effectiveRadius = radiusKm ?? 50;
      const regionKey = `${Math.round(centerLat * 10) / 10}_${Math.round(centerLng * 10) / 10}_${effectiveRadius}`;

      const bucketParam = req.query.bucket as string | undefined;
      const results = await getLeaderboard({
        centerLat,
        centerLng,
        radiusKm,
        tag: tag as string | undefined,
        priceLevel,
        limit: limitNum,
        offset: offsetNum,
        bucket: bucketParam === "bar" ? "bar" : bucketParam === "restaurant" ? "restaurant" : undefined,
      });

      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      let movementMap: Map<string, { delta: number; isNew: boolean }> = new Map();

      try {
        if (!tag && (!priceLevel || priceLevel.length === 0)) {
          const lastSnapshotDate = await storage.getLeaderboardSnapshotDate(regionKey);
          const now = new Date();
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

          if (!lastSnapshotDate || lastSnapshotDate < oneDayAgo) {
            const prevSnapshot = lastSnapshotDate
              ? await storage.getLatestLeaderboardSnapshot(regionKey)
              : [];

            const snapshotEntries = results.map((r, i) => ({
              restaurantId: r.id,
              position: i + 1,
              score: r.score,
            }));
            storage.saveLeaderboardSnapshot(regionKey, snapshotEntries).catch(err =>
              console.error('[snapshot] Leaderboard snapshot save error:', err?.message)
            );

            if (prevSnapshot.length > 0) {
              const prevMap = new Map(prevSnapshot.map(s => [s.restaurantId, s.position]));
              const snapshotDate = prevSnapshot[0]?.snapshotDate;
              const withinWindow = snapshotDate && (now.getTime() - snapshotDate.getTime()) < SEVEN_DAYS_MS;

              if (withinWindow) {
                for (let i = 0; i < results.length; i++) {
                  const r = results[i];
                  const prevPos = prevMap.get(r.id);
                  if (prevPos === undefined) {
                    movementMap.set(r.id, { delta: 0, isNew: true });
                  } else {
                    const delta = prevPos - (i + 1);
                    if (delta !== 0) {
                      movementMap.set(r.id, { delta, isNew: false });
                    }
                  }
                }
              }
            }
          } else {
            const prevSnapshot = await storage.getLatestLeaderboardSnapshot(regionKey);
            if (prevSnapshot.length > 0) {
              const prevMap = new Map(prevSnapshot.map(s => [s.restaurantId, s.position]));
              const snapshotDate = prevSnapshot[0]?.snapshotDate;
              const withinWindow = snapshotDate && (now.getTime() - snapshotDate.getTime()) < SEVEN_DAYS_MS;

              if (withinWindow) {
                for (let i = 0; i < results.length; i++) {
                  const r = results[i];
                  const prevPos = prevMap.get(r.id);
                  if (prevPos === undefined) {
                    movementMap.set(r.id, { delta: 0, isNew: true });
                  } else {
                    const delta = prevPos - (i + 1);
                    if (delta !== 0) {
                      movementMap.set(r.id, { delta, isNew: false });
                    }
                  }
                }
              }
            }
          }
        }
      } catch (snapErr) {
        console.error('[snapshot] Movement computation error:', (snapErr as any)?.message);
      }

      let areaMeta;
      if (!tag) {
        try {
          areaMeta = await getAreaMeta(centerLat, centerLng, effectiveRadius, bucketParam);
        } catch (e) {
          areaMeta = undefined;
        }
      }

      res.json({
        results: results.map((r, i) => {
          const movement = movementMap.get(r.id);
          return {
            ...r,
            score: rescaleTakeScore(r.score),
            movement: movement ? movement.delta : null,
            isNew: movement?.isNew ?? false,
          };
        }),
        ...(areaMeta ? { areaMeta } : {}),
      });
    } catch (error) {
      console.error("Leaderboard error:", error);
      res.status(500).json({ error: "Failed to compute leaderboard" });
    }
  });

  function getISOWeekKey(d: Date): string {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  function getPreviousISOWeekKey(currentWeekKey: string): string {
    const [yearStr, weekStr] = currentWeekKey.split('-W');
    let year = parseInt(yearStr);
    let week = parseInt(weekStr);
    week -= 1;
    if (week < 1) {
      year -= 1;
      const dec28 = new Date(Date.UTC(year, 11, 28));
      const dayNum = dec28.getUTCDay() || 7;
      dec28.setUTCDate(dec28.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(dec28.getUTCFullYear(), 0, 1));
      week = Math.ceil((((dec28.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    }
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  app.get("/api/recap/weekly", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { lat, lng, radius } = req.query;
      const centerLat = lat ? parseFloat(lat as string) : CHATTANOOGA_LAT;
      const centerLng = lng ? parseFloat(lng as string) : CHATTANOOGA_LNG;
      const effectiveRadius = radius ? parseFloat(radius as string) : 50;
      const regionKey = `${Math.round(centerLat * 10) / 10}_${Math.round(centerLng * 10) / 10}_${effectiveRadius}`;

      const lastSeen = await storage.getLastWeeklyRecapSeen(userId);
      const now = new Date();
      if (lastSeen && lastSeen.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) {
        return res.json({ show: false });
      }

      const currentWeek = getISOWeekKey(now);
      const existingSnapshot = await storage.getWeeklySnapshot(regionKey, currentWeek, "overall");

      let currentEntries: { restaurantId: string; position: number; score: number }[];

      if (existingSnapshot.length > 0) {
        currentEntries = existingSnapshot.map(e => ({
          restaurantId: e.restaurantId,
          position: e.position,
          score: e.score ?? 0,
        }));
      } else {
        const leaderboardResults = await getLeaderboard({
          centerLat,
          centerLng,
          radiusKm: effectiveRadius,
          limit: 100,
        });

        currentEntries = leaderboardResults.map((r, i) => ({
          restaurantId: r.id,
          position: i + 1,
          score: r.score,
        }));

        try {
          await storage.saveWeeklySnapshot(regionKey, currentWeek, "overall", currentEntries);
        } catch (err: any) {
          console.error('[weekly-recap] Snapshot save error:', err?.message);
        }
      }

      const previousWeek = getPreviousISOWeekKey(currentWeek);
      const prevSnapshot = await storage.getPreviousWeekSnapshot(regionKey, previousWeek, "overall");

      if (prevSnapshot.length === 0) {
        const topTrending = currentEntries.slice(0, 5);
        const restaurantIds = topTrending.map(e => e.restaurantId);
        const restaurantRows = restaurantIds.length > 0
          ? await db.select().from(restaurants).where(inArray(restaurants.id, restaurantIds))
          : [];
        const restaurantMap = new Map(restaurantRows.map(r => [r.id, r]));

        return res.json({
          show: true,
          firstWeek: true,
          regionKey,
          currentWeek,
          trending: topTrending.map(e => {
            const r = restaurantMap.get(e.restaurantId);
            return {
              placeId: e.restaurantId,
              name: r?.name ?? 'Unknown',
              image: r?.image ?? null,
              rank: e.position,
              score: rescaleTakeScore(e.score),
            };
          }),
        });
      }

      const prevMap = new Map(prevSnapshot.map(e => [e.restaurantId, e.position]));
      const currentMap = new Map(currentEntries.map(e => [e.restaurantId, e.position]));

      const climbers: { restaurantId: string; delta: number; rank: number; score: number }[] = [];
      const fallers: { restaurantId: string; delta: number; rank: number; score: number }[] = [];

      for (const entry of currentEntries) {
        const prevPos = prevMap.get(entry.restaurantId);
        if (prevPos === undefined) continue;
        const delta = prevPos - entry.position;
        if (delta > 0) {
          climbers.push({ restaurantId: entry.restaurantId, delta, rank: entry.position, score: entry.score });
        } else if (delta < 0) {
          fallers.push({ restaurantId: entry.restaurantId, delta, rank: entry.position, score: entry.score });
        }
      }

      climbers.sort((a, b) => b.delta - a.delta);
      fallers.sort((a, b) => a.delta - b.delta);

      const topClimbers = climbers.slice(0, 5);
      const topFallers = fallers.slice(0, 5);

      const allIds = [...topClimbers, ...topFallers].map(e => e.restaurantId);
      const restaurantRows = allIds.length > 0
        ? await db.select().from(restaurants).where(inArray(restaurants.id, allIds))
        : [];
      const restaurantMap = new Map(restaurantRows.map(r => [r.id, r]));

      const formatMover = (m: typeof topClimbers[0]) => {
        const r = restaurantMap.get(m.restaurantId);
        return {
          placeId: m.restaurantId,
          name: r?.name ?? 'Unknown',
          image: r?.image ?? null,
          delta: m.delta,
          rank: m.rank,
          score: rescaleTakeScore(m.score),
        };
      };

      res.json({
        show: true,
        firstWeek: false,
        regionKey,
        currentWeek,
        previousWeek,
        globalMovers: {
          up: topClimbers.map(formatMover),
          down: topFallers.map(formatMover),
        },
      });
    } catch (error) {
      console.error("Weekly recap error:", error);
      res.json({ show: false, error: "Failed to compute recap" });
    }
  });

  app.post("/api/recap/weekly/dismiss", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.updateLastWeeklyRecapSeen(userId);
      res.json({ ok: true });
    } catch (error) {
      console.error("Recap dismiss error:", error);
      res.status(500).json({ error: "Failed to dismiss recap" });
    }
  });

  app.post("/api/ranking-sessions/start", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({ restaurantIds: z.array(z.string()).min(1), bucket: z.enum(["restaurant", "bar"]).optional() });
      const { restaurantIds, bucket } = schema.parse(req.body);
      const result = await startSession(userId, restaurantIds, bucket ?? "restaurant");
      trackEvent("ranking_session_start", userId, { queueSize: restaurantIds.length, bucket: bucket ?? "restaurant" });
      if (result.type === "matchup") {
        const { matchup, ...rest } = result.data;
        const aRestaurant = await storage.getRestaurantById(matchup.aId);
        const bRestaurant = await storage.getRestaurantById(matchup.bId);
        res.json({ type: "matchup", ...rest, matchup: { a: aRestaurant, b: bRestaurant } });
      } else if (result.type === "completed") {
        res.json({ type: "completed", ...result.data });
      } else {
        res.status(400).json({ type: "error", message: (result as any).message });
      }
    } catch (error: any) {
      console.error("Start ranking session error:", error);
      res.status(500).json({ error: error.message || "Failed to start ranking session" });
    }
  });

  app.get("/api/ranking-sessions/active", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bucket = (req.query.bucket as string) === "bar" ? "bar" as const : "restaurant" as const;
      const result = await getActiveSession(userId, bucket);
      if (!result) {
        res.json({ type: "none" });
        return;
      }
      if (result.type === "matchup") {
        const { matchup, ...rest } = result.data;
        const aRestaurant = await storage.getRestaurantById(matchup.aId);
        const bRestaurant = await storage.getRestaurantById(matchup.bId);
        res.json({ type: "matchup", ...rest, matchup: { a: aRestaurant, b: bRestaurant } });
      } else {
        res.json(result);
      }
    } catch (error: any) {
      console.error("Get active session error:", error);
      res.status(500).json({ error: error.message || "Failed to get active session" });
    }
  });

  app.post("/api/ranking-sessions/vote", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({ winnerId: z.string(), bucket: z.enum(["restaurant", "bar"]).optional() });
      const { winnerId, bucket } = schema.parse(req.body);
      const result = await processVote(userId, winnerId, bucket);
      if (result.type === "matchup") {
        const { matchup, ...rest } = result.data;
        const aRestaurant = await storage.getRestaurantById(matchup.aId);
        const bRestaurant = await storage.getRestaurantById(matchup.bId);
        res.json({ type: "matchup", ...rest, matchup: { a: aRestaurant, b: bRestaurant } });
      } else if (result.type === "completed") {
        trackEvent("ranking_session_complete", userId);
        res.json({ type: "completed", ...result.data });
      } else {
        res.status(400).json({ type: "error", message: (result as any).message });
      }
    } catch (error: any) {
      console.error("Vote error:", error);
      res.status(500).json({ error: error.message || "Failed to process vote" });
    }
  });

  app.post("/api/ranking-sessions/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bucket = req.body?.bucket === "bar" ? "bar" as const : undefined;
      const cancelled = await cancelSession(userId, bucket);
      res.json({ success: cancelled });
    } catch (error: any) {
      console.error("Cancel session error:", error);
      res.status(500).json({ error: error.message || "Failed to cancel session" });
    }
  });

  app.post("/api/restaurants/:id/bucket-override", isAuthenticated, async (req: any, res) => {
    try {
      const restaurantId = req.params.id;
      const schema = z.object({
        venueBucket: z.enum(["restaurant", "bar"]),
        isHybrid: z.boolean().optional(),
      });
      const body = schema.parse(req.body);
      await db.update(restaurants)
        .set({
          venueBucket: body.venueBucket,
          isHybrid: body.isHybrid ?? false,
          bucketSource: "user_override",
          bucketConfidence: "high",
        })
        .where(eq(restaurants.id, restaurantId));
      const updated = await storage.getRestaurantById(restaurantId);
      res.json(updated);
    } catch (error: any) {
      console.error("Bucket override error:", error);
      res.status(500).json({ error: error.message || "Failed to override bucket" });
    }
  });

  app.get("/api/leaderboard/hidden-gems", async (req, res) => {
    try {
      const { lat, lng, radius, limit } = req.query;
      const centerLat = lat ? parseFloat(lat as string) : CHATTANOOGA_LAT;
      const centerLng = lng ? parseFloat(lng as string) : CHATTANOOGA_LNG;
      const radiusKm = radius ? parseFloat(radius as string) : undefined;
      const limitNum = limit ? parseInt(limit as string, 10) : undefined;

      const results = await getHiddenGems({
        centerLat,
        centerLng,
        radiusKm,
        limit: limitNum,
      });

      res.json({ results: results.map(r => ({ ...r, score: rescaleTakeScore(r.score) })) });
    } catch (error) {
      console.error("Hidden gems error:", error);
      res.status(500).json({ error: "Failed to compute hidden gems" });
    }
  });

  // ─── Invites ───
  app.post("/api/invites", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const code = generateInviteCode();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const invite = await storage.createInviteLink(userId, code, expiresAt);
      const url = `${req.protocol}://${req.get('host')}/invite/${code}`;
      res.json({ code: invite.code, url });
    } catch (error) {
      console.error("Create invite error:", error);
      res.status(500).json({ error: "Failed to create invite" });
    }
  });

  app.post("/api/invites/redeem", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { code } = z.object({ code: z.string().min(1) }).parse(req.body);
      const invite = await storage.getInviteLinkByCode(code);
      if (!invite) return res.status(404).json({ error: "Invalid invite code" });
      if (invite.expiresAt < new Date()) return res.status(410).json({ error: "Invite has expired" });
      if (invite.uses >= invite.maxUses) return res.status(410).json({ error: "Invite has reached max uses" });
      if (invite.createdByUserId === userId) return res.status(400).json({ error: "Cannot redeem your own invite" });

      await storage.incrementInviteUses(invite.id);
      await storage.createFollow(userId, invite.createdByUserId);

      const inviter = await storage.getUser(invite.createdByUserId);
      const inviterName = inviter ? [inviter.firstName, inviter.lastName].filter(Boolean).join(' ') || 'Someone' : 'Someone';
      res.json({
        success: true,
        inviter: {
          id: invite.createdByUserId,
          name: inviterName,
          profileImageUrl: inviter?.profileImageUrl || null,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      console.error("Redeem invite error:", error);
      res.status(500).json({ error: "Failed to redeem invite" });
    }
  });

  // ─── Follows ───
  app.get("/api/follows", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const [following, followers] = await Promise.all([
        storage.getFollowing(userId),
        storage.getFollowers(userId),
      ]);
      res.json({ following, followers });
    } catch (error) {
      console.error("Get follows error:", error);
      res.status(500).json({ error: "Failed to get follows" });
    }
  });

  app.post("/api/follows/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const followerUserId = req.user.claims.sub;
      const followedUserId = req.params.userId;
      if (followerUserId === followedUserId) return res.status(400).json({ error: "Cannot follow yourself" });
      const targetUser = await storage.getUser(followedUserId);
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      await storage.createFollow(followerUserId, followedUserId);
      res.json({ success: true });
    } catch (error) {
      console.error("Follow error:", error);
      res.status(500).json({ error: "Failed to follow user" });
    }
  });

  app.delete("/api/follows/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const followerUserId = req.user.claims.sub;
      const followedUserId = req.params.userId;
      await storage.deleteFollow(followerUserId, followedUserId);
      res.json({ success: true });
    } catch (error) {
      console.error("Unfollow error:", error);
      res.status(500).json({ error: "Failed to unfollow user" });
    }
  });

  // ─── Compare ───
  const compareCache = new Map<string, { data: any; timestamp: number }>();
  const COMPARE_CACHE_TTL = 10 * 60 * 1000;

  app.get("/api/compare/:otherUserId/regions", isAuthenticated, async (req: any, res) => {
    try {
      const myId = req.user.claims.sub;
      const otherId = req.params.otherUserId;
      const bucket = (req.query.bucket === 'bar' ? 'bar' : 'restaurant') as VenueBucket;
      const connected = await storage.hasConnection(myId, otherId);
      if (!connected) return res.status(403).json({ error: "No connection with this user" });

      const [myRankings, otherRankings] = await Promise.all([
        storage.getUserRankings(myId, bucket),
        storage.getUserRankings(otherId, bucket),
      ]);

      const buildRegionMap = (rankings: typeof myRankings) => {
        const map = new Map<string, Set<string>>();
        for (const r of rankings) {
          if (r.restaurant.lat && r.restaurant.lng) {
            const rk = `${Math.round(r.restaurant.lat * 10) / 10}_${Math.round(r.restaurant.lng * 10) / 10}`;
            if (!map.has(rk)) map.set(rk, new Set());
            map.get(rk)!.add(r.restaurant.id);
          }
        }
        return map;
      };

      const myRegions = buildRegionMap(myRankings);
      const otherRegions = buildRegionMap(otherRankings);

      const sharedRegions: { regionKey: string; label: string; sharedCount: number }[] = [];
      Array.from(myRegions.entries()).forEach(([rk, mySet]) => {
        const otherSet = otherRegions.get(rk);
        if (!otherSet) return;
        const shared = Array.from(mySet).filter(id => otherSet.has(id));
        if (shared.length === 0) return;
        const sampleRestaurant = myRankings.find(r => r.restaurant.id === shared[0]);
        const label = sampleRestaurant?.restaurant.location || rk;
        sharedRegions.push({ regionKey: rk, label, sharedCount: shared.length });
      });

      sharedRegions.sort((a, b) => b.sharedCount - a.sharedCount);
      res.json({ regions: sharedRegions });
    } catch (error) {
      console.error("Compare regions error:", error);
      res.status(500).json({ error: "Failed to get shared regions" });
    }
  });

  app.get("/api/compare/:otherUserId", isAuthenticated, async (req: any, res) => {
    try {
      const myId = req.user.claims.sub;
      const otherId = req.params.otherUserId;
      const regionKey = req.query.regionKey as string | undefined;
      const bucket = (req.query.bucket === 'bar' ? 'bar' : 'restaurant') as VenueBucket;

      const connected = await storage.hasConnection(myId, otherId);
      if (!connected) return res.status(403).json({ error: "No connection with this user" });

      const cacheKey = `${myId}:${otherId}:${regionKey || 'all'}:${bucket}`;
      const cached = compareCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < COMPARE_CACHE_TTL) {
        return res.json(cached.data);
      }

      const [myRankings, otherRankings] = await Promise.all([
        storage.getUserRankings(myId, bucket),
        storage.getUserRankings(otherId, bucket),
      ]);

      const filterByRegion = (rankings: typeof myRankings) => {
        if (!regionKey) return rankings;
        return rankings.filter(r => {
          if (!r.restaurant.lat || !r.restaurant.lng) return false;
          const rk = `${Math.round(r.restaurant.lat * 10) / 10}_${Math.round(r.restaurant.lng * 10) / 10}`;
          return rk === regionKey;
        });
      };

      const myFiltered = filterByRegion(myRankings);
      const otherFiltered = filterByRegion(otherRankings);

      const myMap = new Map(myFiltered.map((r, i) => [r.restaurant.id, { rank: i + 1, restaurant: r.restaurant }]));
      const otherMap = new Map(otherFiltered.map((r, i) => [r.restaurant.id, { rank: i + 1, restaurant: r.restaurant }]));

      const sharedIds = Array.from(myMap.keys()).filter(id => otherMap.has(id));
      const sharedCount = sharedIds.length;

      let tasteOverlap: number | null = null;
      if (sharedCount >= 7) {
        const myRanks = sharedIds.map(id => myMap.get(id)!.rank);
        const otherRanks = sharedIds.map(id => otherMap.get(id)!.rank);
        tasteOverlap = Math.round(spearmanCorrelation(myRanks, otherRanks) * 100);
        tasteOverlap = Math.max(0, Math.min(100, tasteOverlap));
      }

      const myTop10Ids = new Set(myFiltered.slice(0, 10).map(r => r.restaurant.id));
      const otherTop10Ids = new Set(otherFiltered.slice(0, 10).map(r => r.restaurant.id));
      const top10Overlap = Array.from(myTop10Ids).filter(id => otherTop10Ids.has(id)).length;

      const formatPlace = (id: string) => {
        const my = myMap.get(id);
        const other = otherMap.get(id);
        return {
          placeId: id,
          name: (my || other)!.restaurant.name,
          image: (my || other)!.restaurant.image,
          rankA: my?.rank ?? null,
          rankB: other?.rank ?? null,
        };
      };

      const sharedFavorites = sharedIds
        .filter(id => {
          const rA = myMap.get(id)!.rank;
          const rB = otherMap.get(id)!.rank;
          return rA <= 30 || rB <= 30;
        })
        .map(id => formatPlace(id))
        .sort((a, b) => (a.rankA! + a.rankB!) - (b.rankA! + b.rankB!))
        .slice(0, 10);

      const closestRanks = sharedIds
        .map(id => formatPlace(id))
        .sort((a, b) => {
          const diffA = Math.abs(a.rankA! - a.rankB!);
          const diffB = Math.abs(b.rankA! - b.rankB!);
          if (diffA !== diffB) return diffA - diffB;
          return Math.min(a.rankA!, a.rankB!) - Math.min(b.rankA!, b.rankB!);
        })
        .slice(0, 10);

      const disagreements = sharedIds
        .filter(id => {
          const rA = myMap.get(id)!.rank;
          const rB = otherMap.get(id)!.rank;
          return Math.min(rA, rB) <= 30;
        })
        .map(id => formatPlace(id))
        .sort((a, b) => {
          const diffA = Math.abs(a.rankA! - a.rankB!);
          const diffB = Math.abs(b.rankA! - b.rankB!);
          if (diffB !== diffA) return diffB - diffA;
          return Math.min(a.rankA!, a.rankB!) - Math.min(b.rankA!, b.rankB!);
        })
        .slice(0, 10);

      const sideBySideTop10 = {
        me: myFiltered.slice(0, 10).map((r, i) => ({
          placeId: r.restaurant.id,
          name: r.restaurant.name,
          image: r.restaurant.image,
          rank: i + 1,
        })),
        them: otherFiltered.slice(0, 10).map((r, i) => ({
          placeId: r.restaurant.id,
          name: r.restaurant.name,
          image: r.restaurant.image,
          rank: i + 1,
        })),
      };

      const otherUser = await storage.getUser(otherId);
      const otherName = otherUser ? [otherUser.firstName, otherUser.lastName].filter(Boolean).join(' ') || 'Friend' : 'Friend';

      const result = {
        otherUser: { id: otherId, name: otherName, profileImageUrl: otherUser?.profileImageUrl || null },
        sharedCount,
        tasteOverlap,
        top10Overlap,
        agreements: { sharedFavorites, closestRanks },
        disagreements,
        sideBySideTop10,
      };

      compareCache.set(cacheKey, { data: result, timestamp: Date.now() });
      res.json(result);
    } catch (error) {
      console.error("Compare error:", error);
      res.status(500).json({ error: "Failed to compute comparison" });
    }
  });

  setTimeout(() => {
    enrichRestaurantImages().catch(err => console.error("Image enrichment failed:", err));
    enrichRestaurantGoogleTypes().catch(err => console.error("Google types enrichment failed:", err));
    enrichRestaurantCoordinates().catch(err => console.error("Coordinate enrichment failed:", err));
    refreshOldPhotoRefs().catch(err => console.error("Photo ref refresh failed:", err));
  }, 5000);

  setInterval(() => {
    const uptimeMin = Math.round((Date.now() - counterStartedAt) / 60000);
    const total = apiCounters.nearby + apiCounters.details + apiCounters.photo + apiCounters.detailsBgRefresh + apiCounters.newApiTypes + apiCounters.autocomplete;
    const detailsTotal = cacheHitCounters.detailsMem + cacheHitCounters.detailsDb + cacheHitCounters.detailsMiss;
    const detailsHitRate = detailsTotal > 0 ? Math.round((cacheHitCounters.detailsMem + cacheHitCounters.detailsDb) / detailsTotal * 100) : 0;
    console.log(`[api-counters] ${uptimeMin}m uptime | total=${total} | nearby=${apiCounters.nearby} details=${apiCounters.details} photo=${apiCounters.photo} bgRefresh=${apiCounters.detailsBgRefresh} newApiTypes=${apiCounters.newApiTypes} autocomplete=${apiCounters.autocomplete}`);
    console.log(`[cache-hits] details: mem=${cacheHitCounters.detailsMem} db=${cacheHitCounters.detailsDb} miss=${cacheHitCounters.detailsMiss} hitRate=${detailsHitRate}% | photo: mem=${cacheHitCounters.photoMem} db=${cacheHitCounters.photoDb} miss=${cacheHitCounters.photoMiss} | nearby: db=${cacheHitCounters.nearbyDb} miss=${cacheHitCounters.nearbyMiss}`);

    const now = Date.now();
    let placesEvicted = 0;
    const placesKeys = Array.from(PLACES_CACHE.keys());
    for (const key of placesKeys) {
      const entry = PLACES_CACHE.get(key);
      if (entry && now - entry.timestamp > CACHE_TTL) {
        PLACES_CACHE.delete(key);
        placesEvicted++;
      }
    }
    let photosEvicted = 0;
    const photoKeys = Array.from(PHOTO_CACHE.keys());
    for (const key of photoKeys) {
      const entry = PHOTO_CACHE.get(key);
      if (entry && now - entry.timestamp > PHOTO_CACHE_TTL) {
        PHOTO_CACHE.delete(key);
        photosEvicted++;
      }
    }
    if (placesEvicted || photosEvicted) {
      console.log(`[cache-cleanup] Evicted ${placesEvicted} places, ${photosEvicted} photos | remaining: places=${PLACES_CACHE.size} photos=${PHOTO_CACHE.size}`);
    }
  }, 10 * 60 * 1000);

  return httpServer;
}

const ENRICH_MAX_PER_STARTUP = 10; // Cap enrichment API calls per server restart

async function enrichRestaurantImages() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return;

  const noImage = await storage.getRestaurantsWithoutImages();
  if (noImage.length === 0) return;

  const batch = noImage.slice(0, ENRICH_MAX_PER_STARTUP);
  console.log(`[enrich] Found ${noImage.length} restaurants without images, enriching ${batch.length} (capped at ${ENRICH_MAX_PER_STARTUP})...`);

  for (const r of batch) {
    try {
      // Try DB details cache first before hitting Google
      if (r.googlePlaceId) {
        const dbCached = await storage.getCachedPlaceDetails(r.googlePlaceId);
        if (dbCached) {
          const parsed = JSON.parse(dbCached.detailsJson);
          const photoRef = parsed.result?.photos?.[0]?.photo_reference;
          if (photoRef) {
            const imageUrl = `/api/places/photo?ref=${encodeURIComponent(photoRef)}&placeId=${encodeURIComponent(r.googlePlaceId)}`;
            try {
              await storage.updateRestaurantImage(r.id, imageUrl);
            } catch (dupErr: any) {
              if (dupErr?.code !== '23505') throw dupErr;
            }
            console.log(`[enrich] Updated image for "${r.name}" (from DB cache)`);
            continue;
          }
        }
      }

      const query = `${r.name} ${r.location || 'restaurant'}`;
      apiCounters.details++;
      const searchData = await callNewTextSearch(query, apiKey, "places.id,places.displayName,places.photos");

      if (searchData.places?.length > 0) {
        // If the restaurant already has a googlePlaceId, only use a candidate that matches it.
        // Otherwise, verify the candidate name is a fuzzy match to avoid assigning
        // the wrong restaurant's photo when text search returns a different place.
        const candidate = r.googlePlaceId
          ? searchData.places.find((c: any) => c.id === r.googlePlaceId)
          : searchData.places.find((c: any) => {
              const candidateName = c.displayName?.text || '';
              const normCandidate = normalizeNameForDedup(candidateName);
              const normRestaurant = normalizeNameForDedup(r.name);
              return normCandidate === normRestaurant || namesMatchFuzzy(normCandidate, normRestaurant);
            });
        const photoRef = candidate?.photos?.[0]?.name;
        if (photoRef) {
          const candidatePlaceId = candidate.id || r.googlePlaceId || '';
          const imageUrl = `/api/places/photo?ref=${encodeURIComponent(photoRef)}${candidatePlaceId ? '&placeId=' + encodeURIComponent(candidatePlaceId) : ''}`;
          try {
            await storage.updateRestaurantImage(r.id, imageUrl, candidate.id || undefined);
          } catch (dupErr: any) {
            if (dupErr?.code === '23505') {
              await storage.updateRestaurantImage(r.id, imageUrl);
            } else {
              throw dupErr;
            }
          }
          console.log(`[enrich] Updated image for "${r.name}"`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      console.error(`[enrich] Failed for "${r.name}":`, err);
    }
  }

  console.log("[enrich] Image enrichment complete.");
}

async function enrichRestaurantGoogleTypes() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return;

  const allWithPlaceIds = await storage.getAllRestaurantsWithPlaceIds();
  // Only enrich restaurants that have NO primaryType set — this is the definitive marker
  const needsRefresh = allWithPlaceIds.filter(r => !r.googlePrimaryType);

  if (needsRefresh.length === 0) {
    console.log("[enrich-types] All restaurants already have primaryType.");
    return;
  }

  const batch = needsRefresh.slice(0, ENRICH_MAX_PER_STARTUP);
  console.log(`[enrich-types] Found ${needsRefresh.length} restaurants needing primaryType, enriching ${batch.length} (capped at ${ENRICH_MAX_PER_STARTUP})...`);

  for (const r of batch) {
    if (!r.googlePlaceId) continue;
    try {
      apiCounters.newApiTypes++;
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${r.googlePlaceId}`,
        {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'types,primaryType',
          },
        }
      );
      const data = await response.json() as any;

      if (data.types && data.types.length > 0) {
        const primaryType = data.primaryType || data.types[0] || null;
        await storage.backfillGoogleTypes(r.googlePlaceId, data.types, primaryType);
        console.log(`[enrich-types] Updated "${r.name}": primary=${primaryType}`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.error(`[enrich-types] Failed for "${r.name}":`, err);
    }
  }

  console.log("[enrich-types] Google types enrichment complete.");
}

async function enrichRestaurantCoordinates() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return;

  const noCoords = await storage.getRestaurantsWithoutCoordinates();
  if (noCoords.length === 0) return;

  const batch = noCoords.slice(0, ENRICH_MAX_PER_STARTUP);
  console.log(`[enrich-coords] Found ${noCoords.length} restaurants without coordinates, enriching ${batch.length} (capped at ${ENRICH_MAX_PER_STARTUP})...`);

  for (const r of batch) {
    if (!r.googlePlaceId) continue;
    try {
      // Try DB details cache first before hitting Google
      const dbCached = await storage.getCachedPlaceDetails(r.googlePlaceId);
      if (dbCached) {
        const parsed = JSON.parse(dbCached.detailsJson);
        const loc = parsed.result?.geometry?.location;
        if (loc?.lat && loc?.lng) {
          await storage.updateRestaurantCoordinates(r.id, loc.lat, loc.lng);
          console.log(`[enrich-coords] Updated coordinates for "${r.name}" (from DB cache): ${loc.lat}, ${loc.lng}`);
          continue;
        }
      }

      apiCounters.details++;
      const rawData = await callNewPlaceDetails(r.googlePlaceId!, apiKey, "location");
      if (rawData.location) {
        const lat = rawData.location.latitude;
        const lng = rawData.location.longitude;
        await storage.updateRestaurantCoordinates(r.id, lat, lng);
        console.log(`[enrich-coords] Updated coordinates for "${r.name}": ${lat}, ${lng}`);
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (err) {
      console.error(`[enrich-coords] Failed for "${r.name}":`, err);
    }
  }

  console.log("[enrich-coords] Coordinate enrichment complete.");
}

async function refreshOldPhotoRefs() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return;

  const allRestaurants = await storage.getAllRestaurantsWithPlaceIds();
  const oldRefs = allRestaurants.filter(r => {
    if (!r.image || !r.googlePlaceId) return false;
    const refMatch = r.image.match(/[?&]ref=([^&]+)/);
    if (!refMatch) return false;
    const ref = decodeURIComponent(refMatch[1]);
    return !ref.startsWith('places/');
  });

  if (oldRefs.length === 0) {
    console.log("[enrich-photo-refs] All restaurant images already use new API format.");
    return;
  }

  const batch = oldRefs.slice(0, ENRICH_MAX_PER_STARTUP);
  console.log(`[enrich-photo-refs] Found ${oldRefs.length} restaurants with old photo refs, refreshing ${batch.length} (capped at ${ENRICH_MAX_PER_STARTUP})...`);

  let updated = 0;
  for (const r of batch) {
    try {
      const cached = await storage.getCachedPlaceDetails(r.googlePlaceId!);
      if (cached) {
        const parsed = JSON.parse(cached.detailsJson);
        const photos = parsed.result?.photos || [];
        const newRef = photos[0]?.photo_reference;
        if (newRef && newRef.startsWith('places/')) {
          const imageUrl = `/api/places/photo?ref=${encodeURIComponent(newRef)}&placeId=${encodeURIComponent(r.googlePlaceId!)}`;
          await storage.updateRestaurantImage(r.id, imageUrl);
          console.log(`[enrich-photo-refs] Updated "${r.name}" with new API ref (from cache)`);
          updated++;
          continue;
        }
      }

      apiCounters.details++;
      const data = await callNewPlaceDetails(r.googlePlaceId!, apiKey, "photos");
      if (data.photos?.length > 0) {
        const photoName = data.photos[0].name;
        if (photoName) {
          const imageUrl = `/api/places/photo?ref=${encodeURIComponent(photoName)}&placeId=${encodeURIComponent(r.googlePlaceId!)}`;
          await storage.updateRestaurantImage(r.id, imageUrl);
          console.log(`[enrich-photo-refs] Updated "${r.name}" with new API ref (from API)`);
          updated++;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      console.error(`[enrich-photo-refs] Failed for "${r.name}":`, err);
    }
  }

  console.log(`[enrich-photo-refs] Photo ref refresh complete. Updated ${updated}/${batch.length}.`);
}
