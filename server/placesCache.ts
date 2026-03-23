import { storage } from "./storage";
import { encodeGeohash } from "@shared/geohash";

const NEARBY_TTL_MS = 60 * 60 * 1000;
const VIEWPORT_TTL_MS = 30 * 60 * 1000;
const CATEGORY_TTL_MS = 60 * 60 * 1000;
const MAX_RESULTS = 60;
const MAX_GOOGLE_CALLS_PER_REQUEST = 2;

export { MAX_RESULTS, MAX_GOOGLE_CALLS_PER_REQUEST };

function bucketRadius(radiusMeters: number): string {
  if (radiusMeters <= 5000) return "5km";
  if (radiusMeters <= 15000) return "15km";
  if (radiusMeters <= 30000) return "30km";
  return "100km";
}

export function buildNearbyCacheKey(lat: number, lng: number, radiusMeters: number, pageToken?: string, tag?: string): string {
  if (pageToken) {
    return `nearby:page:${pageToken}`;
  }
  const gh = encodeGeohash(lat, lng, 6);
  const rb = bucketRadius(radiusMeters);
  const tagPart = tag ? `:tag:${tag}` : "";
  return `nearby:${gh}:${rb}${tagPart}`;
}

export function buildCategoryCacheKey(lat: number, lng: number, keyword: string, type: string): string {
  const gh = encodeGeohash(lat, lng, 6);
  return `category:${gh}:${keyword || "none"}:${type}`;
}

export function buildViewportCacheKey(lat: number, lng: number, radiusMeters: number, tag?: string): string {
  const gh = encodeGeohash(lat, lng, 5);
  const rb = bucketRadius(radiusMeters);
  const tagPart = tag ? `:tag:${tag}` : "";
  return `viewport:${gh}:${rb}${tagPart}`;
}

export function getTtlForEndpoint(endpoint: "nearby" | "viewport" | "category"): number {
  switch (endpoint) {
    case "nearby": return NEARBY_TTL_MS;
    case "viewport": return VIEWPORT_TTL_MS;
    case "category": return CATEGORY_TTL_MS;
  }
}

export async function getCachedPayload(cacheKey: string, allowStale: boolean = false): Promise<any | undefined> {
  try {
    const json = await storage.getSearchCache(cacheKey, allowStale);
    if (json) return JSON.parse(json);
  } catch {
  }
  return undefined;
}

export async function setCachedPayload(cacheKey: string, payload: any, ttlMs: number): Promise<void> {
  try {
    await storage.setSearchCache(cacheKey, JSON.stringify(payload), ttlMs);
  } catch {
  }
}

export function normalizeNameForDedup(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesMatchFuzzy(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 5) return false;
  const wordCount = shorter.split(" ").length;
  if (wordCount < 2) return false;
  if (longer.startsWith(shorter + " ") || longer.startsWith(shorter)) {
    if (longer.length === shorter.length || longer[shorter.length] === " ") return true;
  }
  return false;
}

export function dedupeByPlaceId(results: any[]): any[] {
  const seenIds = new Set<string>();
  const seenNames: string[] = [];
  const seenNameToOutIdx = new Map<string, number>();
  const output: any[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const id = r.place_id;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const norm = normalizeNameForDedup(r.name || "");
    if (norm.length >= 3) {
      let matchIdx = seenNameToOutIdx.get(norm);
      if (matchIdx === undefined) {
        for (let j = 0; j < seenNames.length; j++) {
          if (namesMatchFuzzy(norm, seenNames[j])) {
            matchIdx = seenNameToOutIdx.get(seenNames[j]);
            break;
          }
        }
      }
      if (matchIdx !== undefined) {
        if (r.take_score && !output[matchIdx].take_score) {
          output[matchIdx] = r;
        }
        continue;
      }
      seenNames.push(norm);
      seenNameToOutIdx.set(norm, output.length);
    }
    output.push(r);
  }
  return output;
}

export function capResults(results: any[]): any[] {
  return results.slice(0, MAX_RESULTS);
}

let lastCleanup = 0;
const CLEANUP_INTERVAL = 30 * 60 * 1000;

export async function maybeCleanupCache(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  try {
    await storage.cleanupExpiredSearchCache();
  } catch {
  }
}
