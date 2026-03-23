import { db } from "./db";
import { restaurants, userRankings } from "@shared/schema";
import { sql, and, gte, lte, eq, inArray } from "drizzle-orm";
import { getGoogleTypesForTag } from "./tagMapping";

export interface LeaderboardParams {
  centerLat: number;
  centerLng: number;
  radiusKm?: number;
  tag?: string;
  priceLevel?: number[];
  limit?: number;
  offset?: number;
  bucket?: string;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  image: string | null;
  category: string | null;
  location: string | null;
  priceLevel: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  tags: string[] | null;
  googleTypes: string[] | null;
  googlePrimaryType: string | null;
  score: number;
  appearances: number;
  avgRank: number;
}

const DEFAULT_RADIUS_KM = 50;

export function rescaleTakeScore(rawScore: number): number {
  const rescaled = 60 + rawScore * 39;
  return Math.round(Math.min(99, Math.max(60, rescaled)));
}
const MIN_CREDIBLE_APPEARANCES = 10;

function boundsFromCenter(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export interface AreaMeta {
  totalRanked: number;
  uniqueUsers: number;
}

export async function getAreaMeta(centerLat: number, centerLng: number, radiusKm: number = DEFAULT_RADIUS_KM, bucket?: string): Promise<AreaMeta> {
  const bounds = boundsFromCenter(centerLat, centerLng, radiusKm);
  const conditions: any[] = [
    gte(restaurants.lat, bounds.minLat),
    lte(restaurants.lat, bounds.maxLat),
    gte(restaurants.lng, bounds.minLng),
    lte(restaurants.lng, bounds.maxLng),
  ];
  if (bucket) {
    conditions.push(eq(userRankings.bucket, bucket));
  }
  const result = await db
    .select({
      totalRanked: sql<number>`count(distinct ${userRankings.restaurantId})`,
      uniqueUsers: sql<number>`count(distinct ${userRankings.userId})`,
    })
    .from(userRankings)
    .innerJoin(restaurants, eq(restaurants.id, userRankings.restaurantId))
    .where(and(...conditions));
  return {
    totalRanked: Number(result[0]?.totalRanked ?? 0),
    uniqueUsers: Number(result[0]?.uniqueUsers ?? 0),
  };
}

export async function getLeaderboard(params: LeaderboardParams): Promise<LeaderboardEntry[]> {
  const radiusKm = params.radiusKm ?? DEFAULT_RADIUS_KM;
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const bounds = boundsFromCenter(params.centerLat, params.centerLng, radiusKm);

  const conditions: any[] = [
    gte(restaurants.lat, bounds.minLat),
    lte(restaurants.lat, bounds.maxLat),
    gte(restaurants.lng, bounds.minLng),
    lte(restaurants.lng, bounds.maxLng),
  ];

  if (params.priceLevel && params.priceLevel.length > 0) {
    const priceLevels = params.priceLevel.map(p => String(p));
    conditions.push(inArray(restaurants.priceLevel, priceLevels));
  }

  if (params.bucket) {
    conditions.push(eq(restaurants.venueBucket, params.bucket));
  }

  const regionFilter = and(...conditions);

  const rankingConditions: any[] = [eq(restaurants.id, userRankings.restaurantId)];
  if (params.bucket) {
    rankingConditions.push(eq(userRankings.bucket, params.bucket));
  }

  const rawRows = await db
    .select({
      restaurantId: restaurants.id,
      name: restaurants.name,
      image: restaurants.image,
      category: restaurants.category,
      location: restaurants.location,
      priceLevel: restaurants.priceLevel,
      lat: restaurants.lat,
      lng: restaurants.lng,
      googlePlaceId: restaurants.googlePlaceId,
      tags: restaurants.tags,
      googleTypes: restaurants.googleTypes,
      googlePrimaryType: restaurants.googlePrimaryType,
      rankPosition: userRankings.rankPosition,
      listLength: userRankings.listLength,
    })
    .from(restaurants)
    .leftJoin(userRankings, and(...rankingConditions))
    .where(regionFilter!);

  const restaurantMap = new Map<string, {
    id: string;
    name: string;
    image: string | null;
    category: string | null;
    location: string | null;
    priceLevel: string | null;
    lat: number | null;
    lng: number | null;
    googlePlaceId: string | null;
    tags: string[] | null;
    googleTypes: string[] | null;
    googlePrimaryType: string | null;
    scores: number[];
  }>();

  for (const row of rawRows) {
    if (!restaurantMap.has(row.restaurantId)) {
      restaurantMap.set(row.restaurantId, {
        id: row.restaurantId,
        name: row.name,
        image: row.image,
        category: row.category,
        location: row.location,
        priceLevel: row.priceLevel,
        lat: row.lat,
        lng: row.lng,
        googlePlaceId: row.googlePlaceId,
        tags: row.tags,
        googleTypes: row.googleTypes,
        googlePrimaryType: row.googlePrimaryType,
        scores: [],
      });
    }

    if (row.rankPosition !== null && row.listLength !== null && row.listLength > 1) {
      const normalizedScore = (row.listLength - row.rankPosition) / (row.listLength - 1);
      restaurantMap.get(row.restaurantId)!.scores.push(normalizedScore);
    }
  }

  let entries = Array.from(restaurantMap.values());

  if (params.priceLevel && params.priceLevel.length > 0) {
    const priceLevels = new Set(params.priceLevel.map(String));
    entries = entries.filter(e => e.priceLevel !== null && priceLevels.has(e.priceLevel));
  }

  const allR: number[] = [];
  for (const entry of entries) {
    if (entry.scores.length > 0) {
      const avg = entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length;
      allR.push(avg);
    }
  }

  const C = allR.length > 0 ? allR.reduce((a, b) => a + b, 0) / allR.length : 0.5;
  const m = MIN_CREDIBLE_APPEARANCES;

  let scored: LeaderboardEntry[] = entries.map(entry => {
    const v = entry.scores.length;
    const R = v > 0 ? entry.scores.reduce((a, b) => a + b, 0) / v : C;
    const S = (v / (v + m)) * R + (m / (v + m)) * C;

    return {
      id: entry.id,
      name: entry.name,
      image: entry.image,
      category: entry.category,
      location: entry.location,
      priceLevel: entry.priceLevel,
      lat: entry.lat,
      lng: entry.lng,
      googlePlaceId: entry.googlePlaceId,
      tags: entry.tags,
      googleTypes: entry.googleTypes,
      googlePrimaryType: entry.googlePrimaryType,
      score: S,
      appearances: v,
      avgRank: R,
    };
  });

  const MIN_LEADERBOARD_APPEARANCES = 1;
  scored = scored.filter(e => e.appearances >= MIN_LEADERBOARD_APPEARANCES);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.appearances - a.appearances;
  });

  if (params.tag) {
    const mappedTypes = getGoogleTypesForTag(params.tag);
    const mapped = new Set(mappedTypes);
    const tagLower = params.tag.toLowerCase();
    scored = scored.filter(e => {
      const enrichedTags = e.tags ?? [];
      if (enrichedTags.includes(tagLower)) return true;
      const gt = e.googleTypes ?? [];
      const hasTypeOverlap = Array.isArray(gt) && gt.some(t => mapped.has(t));
      const hasPrimary = e.googlePrimaryType ? mapped.has(e.googlePrimaryType) : false;
      return hasTypeOverlap || hasPrimary;
    });
  }

  return scored.slice(offset, offset + limit);
}

export async function getHiddenGems(params: {
  centerLat: number;
  centerLng: number;
  radiusKm?: number;
  limit?: number;
}): Promise<LeaderboardEntry[]> {
  const radiusKm = params.radiusKm ?? DEFAULT_RADIUS_KM;
  const limit = params.limit ?? 6;
  const bounds = boundsFromCenter(params.centerLat, params.centerLng, radiusKm);

  const conditions = [
    gte(restaurants.lat, bounds.minLat),
    lte(restaurants.lat, bounds.maxLat),
    gte(restaurants.lng, bounds.minLng),
    lte(restaurants.lng, bounds.maxLng),
  ];

  const regionFilter = and(...conditions);

  const rawRows = await db
    .select({
      restaurantId: restaurants.id,
      name: restaurants.name,
      image: restaurants.image,
      category: restaurants.category,
      location: restaurants.location,
      priceLevel: restaurants.priceLevel,
      lat: restaurants.lat,
      lng: restaurants.lng,
      googlePlaceId: restaurants.googlePlaceId,
      tags: restaurants.tags,
      googleTypes: restaurants.googleTypes,
      googlePrimaryType: restaurants.googlePrimaryType,
      rankPosition: userRankings.rankPosition,
      listLength: userRankings.listLength,
    })
    .from(restaurants)
    .leftJoin(userRankings, eq(restaurants.id, userRankings.restaurantId))
    .where(regionFilter!);

  const restaurantMap = new Map<string, {
    id: string;
    name: string;
    image: string | null;
    category: string | null;
    location: string | null;
    priceLevel: string | null;
    lat: number | null;
    lng: number | null;
    googlePlaceId: string | null;
    tags: string[] | null;
    googleTypes: string[] | null;
    googlePrimaryType: string | null;
    scores: number[];
  }>();

  for (const row of rawRows) {
    if (!restaurantMap.has(row.restaurantId)) {
      restaurantMap.set(row.restaurantId, {
        id: row.restaurantId,
        name: row.name,
        image: row.image,
        category: row.category,
        location: row.location,
        priceLevel: row.priceLevel,
        lat: row.lat,
        lng: row.lng,
        googlePlaceId: row.googlePlaceId,
        tags: row.tags,
        googleTypes: row.googleTypes,
        googlePrimaryType: row.googlePrimaryType,
        scores: [],
      });
    }
    if (row.rankPosition !== null && row.listLength !== null && row.listLength > 1) {
      const normalizedScore = (row.listLength - row.rankPosition) / (row.listLength - 1);
      restaurantMap.get(row.restaurantId)!.scores.push(normalizedScore);
    }
  }

  const gems: LeaderboardEntry[] = [];
  const allEntries = Array.from(restaurantMap.values());
  for (const entry of allEntries) {
    const v = entry.scores.length;
    if (v < 1 || v >= MIN_CREDIBLE_APPEARANCES) continue;
    const R = entry.scores.reduce((a: number, b: number) => a + b, 0) / v;
    if (R < 0.55) continue;

    gems.push({
      id: entry.id,
      name: entry.name,
      image: entry.image,
      category: entry.category,
      location: entry.location,
      priceLevel: entry.priceLevel,
      lat: entry.lat,
      lng: entry.lng,
      googlePlaceId: entry.googlePlaceId,
      tags: entry.tags,
      googleTypes: entry.googleTypes,
      googlePrimaryType: entry.googlePrimaryType,
      score: R,
      appearances: v,
      avgRank: R,
    });
  }

  gems.sort((a, b) => {
    const aGem = a.avgRank * Math.log2(a.appearances + 1);
    const bGem = b.avgRank * Math.log2(b.appearances + 1);
    return bGem - aGem;
  });

  return gems.slice(0, limit);
}

export interface GroupLeaderboardParams {
  memberUserIds: string[];
  tag?: string;
  limit?: number;
  offset?: number;
}

export async function getGroupLeaderboard(params: GroupLeaderboardParams): Promise<LeaderboardEntry[]> {
  const { memberUserIds, tag, limit = 50, offset = 0 } = params;

  if (memberUserIds.length === 0) return [];

  const conditions: any[] = [
    inArray(userRankings.userId, memberUserIds),
  ];

  const rawRows = await db
    .select({
      restaurantId: restaurants.id,
      name: restaurants.name,
      image: restaurants.image,
      category: restaurants.category,
      location: restaurants.location,
      priceLevel: restaurants.priceLevel,
      lat: restaurants.lat,
      lng: restaurants.lng,
      googlePlaceId: restaurants.googlePlaceId,
      tags: restaurants.tags,
      googleTypes: restaurants.googleTypes,
      googlePrimaryType: restaurants.googlePrimaryType,
      rankPosition: userRankings.rankPosition,
      listLength: userRankings.listLength,
    })
    .from(userRankings)
    .innerJoin(restaurants, eq(userRankings.restaurantId, restaurants.id))
    .where(and(...conditions));

  const restaurantMap = new Map<string, {
    id: string;
    name: string;
    image: string | null;
    category: string | null;
    location: string | null;
    priceLevel: string | null;
    lat: number | null;
    lng: number | null;
    googlePlaceId: string | null;
    tags: string[] | null;
    googleTypes: string[] | null;
    googlePrimaryType: string | null;
    scores: number[];
  }>();

  for (const row of rawRows) {
    if (!restaurantMap.has(row.restaurantId)) {
      restaurantMap.set(row.restaurantId, {
        id: row.restaurantId,
        name: row.name,
        image: row.image,
        category: row.category,
        location: row.location,
        priceLevel: row.priceLevel,
        lat: row.lat,
        lng: row.lng,
        googlePlaceId: row.googlePlaceId,
        tags: row.tags,
        googleTypes: row.googleTypes,
        googlePrimaryType: row.googlePrimaryType,
        scores: [],
      });
    }

    if (row.rankPosition !== null && row.listLength !== null && row.listLength > 1) {
      const normalizedScore = (row.listLength - row.rankPosition) / (row.listLength - 1);
      restaurantMap.get(row.restaurantId)!.scores.push(normalizedScore);
    }
  }

  let entries = Array.from(restaurantMap.values());

  if (tag) {
    const mappedTypes = getGoogleTypesForTag(tag);
    const typeSet = new Set(mappedTypes);
    const tagLower = tag.toLowerCase();
    entries = entries.filter(e => {
      const enrichedTags = e.tags || [];
      if (enrichedTags.includes(tagLower)) return true;
      const gTypes = e.googleTypes || [];
      const gPrimary = e.googlePrimaryType;
      return gTypes.some(t => typeSet.has(t)) || (gPrimary && typeSet.has(gPrimary));
    });
  }

  const GROUP_MIN_APPEARANCES = 1;

  const allR: number[] = [];
  for (const entry of entries) {
    if (entry.scores.length > 0) {
      allR.push(entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length);
    }
  }

  const C = allR.length > 0 ? allR.reduce((a, b) => a + b, 0) / allR.length : 0.5;
  const m = GROUP_MIN_APPEARANCES;

  let scored: LeaderboardEntry[] = entries.map(entry => {
    const v = entry.scores.length;
    const R = v > 0 ? entry.scores.reduce((a, b) => a + b, 0) / v : C;
    const S = (v / (v + m)) * R + (m / (v + m)) * C;

    return {
      id: entry.id,
      name: entry.name,
      image: entry.image,
      category: entry.category,
      location: entry.location,
      priceLevel: entry.priceLevel,
      lat: entry.lat,
      lng: entry.lng,
      googlePlaceId: entry.googlePlaceId,
      tags: entry.tags,
      googleTypes: entry.googleTypes,
      googlePrimaryType: entry.googlePrimaryType,
      score: S,
      appearances: v,
      avgRank: R,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.appearances - a.appearances;
  });

  if (params.tag) {
    const mappedTypes = getGoogleTypesForTag(params.tag);
    const mapped = new Set(mappedTypes);
    const tagLower = params.tag.toLowerCase();
    scored = scored.filter(e => {
      const enrichedTags = e.tags ?? [];
      if (enrichedTags.includes(tagLower)) return true;
      const gt = e.googleTypes ?? [];
      const hasTypeOverlap = Array.isArray(gt) && gt.some(t => mapped.has(t));
      const hasPrimary = e.googlePrimaryType ? mapped.has(e.googlePrimaryType) : false;
      return hasTypeOverlap || hasPrimary;
    });
  }

return scored.slice(offset, offset + limit);
}
