import { eq, and, sql, isNull, or, desc, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  users, restaurants, userRankings, pairwiseMatchups,
  groups, groupMembers, placeDetailsCache, placesSearchCache,
  leaderboardSnapshots, userRankingSnapshots, rankingSessions,
  restaurantReports, accountDeletionRequests, follows, inviteLinks,
  type User, type UpsertUser,
  type Restaurant, type InsertRestaurant,
  type InsertUserRanking,
  type InsertPairwiseMatchup, type PairwiseMatchup,
  type Group, type GroupMember,
  type LeaderboardSnapshot, type UserRankingSnapshot,
  type RankingSession,
  type RestaurantReport, type AccountDeletionRequest,
  type VenueBucket, type Follow, type InviteLink,
} from "@shared/schema";
import { enrichTags, inferCategory } from "@shared/tagInference";
import { classifyVenue } from "./venueClassification";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserProfile(id: string, data: { firstName?: string; lastName?: string }): Promise<User | undefined>;
  createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant>;
  getRestaurantByPlaceId(placeId: string): Promise<Restaurant | undefined>;
  getRestaurantById(id: string): Promise<Restaurant | undefined>;
  upsertRestaurant(restaurant: InsertRestaurant): Promise<Restaurant>;
  syncUserRankings(userId: string, rankings: { restaurantId: string; rankPosition: number; listLength: number }[], bucket?: VenueBucket): Promise<void>;
  getUserRankings(userId: string, bucket?: VenueBucket): Promise<{ restaurant: Restaurant; rankPosition: number; listLength: number }[]>;
  deleteUserRankings(userId: string, bucket?: VenueBucket): Promise<void>;
  getRestaurantsWithoutImages(): Promise<Restaurant[]>;
  getRestaurantsWithoutCoordinates(): Promise<Restaurant[]>;
  updateRestaurantCoordinates(id: string, lat: number, lng: number): Promise<void>;
  getRestaurantsWithoutGoogleTypes(): Promise<Restaurant[]>;
  updateRestaurantImage(id: string, image: string, googlePlaceId?: string): Promise<void>;
  backfillGoogleTypes(googlePlaceId: string, googleTypes: string[], googlePrimaryType: string | null): Promise<void>;
  getAllRestaurantsWithPlaceIds(): Promise<Restaurant[]>;
  logPairwiseMatchup(matchup: InsertPairwiseMatchup): Promise<PairwiseMatchup>;
  getMatchupsByPlaceId(placeId: string, limit?: number): Promise<PairwiseMatchup[]>;
  createGroup(name: string, userId: string, joinCode: string): Promise<Group>;
  getGroupById(id: string): Promise<Group | undefined>;
  getGroupByJoinCode(code: string): Promise<Group | undefined>;
  getGroupsByUserId(userId: string): Promise<(Group & { memberCount: number; role: string })[]>;
  getGroupMembers(groupId: string): Promise<(GroupMember & { displayName: string })[]>;
  addGroupMember(groupId: string, userId: string, role: string): Promise<GroupMember>;
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  isGroupMember(groupId: string, userId: string): Promise<boolean>;
  getGroupMemberUserIds(groupId: string): Promise<string[]>;
  getCachedPlaceDetails(placeId: string): Promise<{ detailsJson: string; photoReference: string | null; fetchedAt: Date; isStale: boolean } | undefined>;
  cachePlaceDetails(placeId: string, detailsJson: string, photoReference: string | null): Promise<void>;
  clearCachedPlaceDetails(placeId: string): Promise<void>;
  saveLeaderboardSnapshot(regionKey: string, entries: { restaurantId: string; position: number; score: number }[]): Promise<void>;
  getLatestLeaderboardSnapshot(regionKey: string): Promise<{ restaurantId: string; position: number; snapshotDate: Date }[]>;
  getLeaderboardSnapshotDate(regionKey: string): Promise<Date | null>;
  saveUserRankingSnapshot(userId: string, entries: { restaurantId: string; position: number }[]): Promise<void>;
  getLatestUserRankingSnapshot(userId: string): Promise<{ restaurantId: string; position: number; snapshotDate: Date }[]>;
  createRankingSession(data: { userId: string; queue: string[]; currentIndex: number; currentPlaceId: string; insertionState: any; userRankingOrder: string[]; status: string; bucket?: VenueBucket }): Promise<RankingSession>;
  getActiveRankingSession(userId: string, bucket?: VenueBucket): Promise<RankingSession | undefined>;
  updateRankingSession(sessionId: string, updates: Partial<{ status: string; currentIndex: number; currentPlaceId: string | null; insertionState: any; userRankingOrder: string[] }>): Promise<void>;
  abandonActiveRankingSessions(userId: string, bucket?: VenueBucket): Promise<void>;
  getSearchCache(cacheKey: string, allowStale?: boolean): Promise<string | undefined>;
  setSearchCache(cacheKey: string, payloadJson: string, ttlMs: number): Promise<void>;
  cleanupExpiredSearchCache(): Promise<void>;
  createReport(userId: string, placeId: string, reason: string, message?: string | null): Promise<RestaurantReport>;
  getReportsByUser(userId: string): Promise<RestaurantReport[]>;
  getOpenReports(limit: number, offset: number): Promise<RestaurantReport[]>;
  resolveReport(id: string): Promise<void>;
  createDeletionRequest(userId: string, message?: string | null): Promise<AccountDeletionRequest>;
  getDeletionRequestsByUser(userId: string): Promise<AccountDeletionRequest[]>;
  getOpenDeletionRequests(limit: number, offset: number): Promise<AccountDeletionRequest[]>;
  resolveDeletionRequest(id: string): Promise<void>;
  completeDeletionRequest(id: string): Promise<void>;
  getDeletionRequestById(id: string): Promise<AccountDeletionRequest | undefined>;
  anonymizeUser(userId: string): Promise<void>;
  getUserMatchupCount(userId: string): Promise<number>;
  getUserSessionsSummary(userId: string): Promise<{ total: number; completed: number; abandoned: number }>;
  getWeeklySnapshot(regionKey: string, weekKey: string, scope?: string): Promise<{ restaurantId: string; position: number; score: number | null }[]>;
  saveWeeklySnapshot(regionKey: string, weekKey: string, scope: string, entries: { restaurantId: string; position: number; score: number }[]): Promise<void>;
  getPreviousWeekSnapshot(regionKey: string, currentWeekKey: string, scope?: string): Promise<{ restaurantId: string; position: number; score: number | null }[]>;
  updateLastWeeklyRecapSeen(userId: string): Promise<void>;
  getLastWeeklyRecapSeen(userId: string): Promise<Date | null>;
  createFollow(followerUserId: string, followedUserId: string): Promise<Follow>;
  deleteFollow(followerUserId: string, followedUserId: string): Promise<void>;
  getFollowing(userId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null }[]>;
  getFollowers(userId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null }[]>;
  isFollowing(followerUserId: string, followedUserId: string): Promise<boolean>;
  hasConnection(userA: string, userB: string): Promise<boolean>;
  createInviteLink(userId: string, code: string, expiresAt: Date): Promise<InviteLink>;
  getInviteLinkByCode(code: string): Promise<InviteLink | undefined>;
  incrementInviteUses(id: string): Promise<void>;
  getUserRankingsRaw(userId: string, bucket?: VenueBucket): Promise<{ restaurantId: string; rankPosition: number }[]>;
}

const GENERIC_ONLY_TAGS = ['restaurant', 'bar', 'cafe', 'bakery', 'store', 'meal_delivery', 'meal_takeaway', 'food', 'point_of_interest', 'establishment'];

function hasOnlyGenericTags(tags: string[]): boolean {
  return tags.length === 0 || tags.every(t => GENERIC_ONLY_TAGS.includes(t.toLowerCase()));
}

function applyTagEnrichment(name: string, tags: string[] | null, category: string | null, googleTypes?: string[] | null, googlePrimaryType?: string | null): { tags: string[]; category: string } {
  const rawTags = tags ?? [];
  const gTypes = googleTypes ?? undefined;
  const enrichedTags = enrichTags(name, rawTags, gTypes);
  const enrichedCategory = inferCategory(name, enrichedTags, gTypes, googlePrimaryType ?? undefined);
  return { tags: enrichedTags, category: enrichedCategory };
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(insertUser: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserProfile(id: string, data: { firstName?: string; lastName?: string }): Promise<User | undefined> {
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    const [user] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    return user;
  }

  async createRestaurant(insertRestaurant: InsertRestaurant): Promise<Restaurant> {
    const { tags: enrichedTags, category: enrichedCategory } = applyTagEnrichment(
      insertRestaurant.name, 
      insertRestaurant.tags as string[] | null, 
      insertRestaurant.category as string | null,
      insertRestaurant.googleTypes as string[] | null,
      insertRestaurant.googlePrimaryType as string | null
    );
    const classification = classifyVenue(
      insertRestaurant.name,
      insertRestaurant.googleTypes as string[] | null,
      insertRestaurant.googlePrimaryType as string | null
    );
    const enriched = {
      ...insertRestaurant,
      tags: enrichedTags,
      category: enrichedCategory,
      venueBucket: insertRestaurant.venueBucket ?? classification.venueBucket,
      isHybrid: insertRestaurant.isHybrid ?? classification.isHybrid,
      bucketSource: insertRestaurant.bucketSource ?? classification.bucketSource,
      bucketConfidence: insertRestaurant.bucketConfidence ?? classification.bucketConfidence,
    };
    const [restaurant] = await db.insert(restaurants).values(enriched).returning();
    return restaurant;
  }

  async getRestaurantByPlaceId(placeId: string): Promise<Restaurant | undefined> {
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.googlePlaceId, placeId));
    return restaurant;
  }

  async getRestaurantById(id: string): Promise<Restaurant | undefined> {
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id));
    return restaurant;
  }

  private applyUpdates(existing: Restaurant, data: InsertRestaurant): Partial<InsertRestaurant> {
    const updates: Partial<InsertRestaurant> = {};
    if (data.lat !== undefined && data.lat !== null && existing.lat === null) updates.lat = data.lat;
    if (data.lng !== undefined && data.lng !== null && existing.lng === null) updates.lng = data.lng;
    if (data.image && !existing.image) updates.image = data.image;
    if (data.priceLevel && !existing.priceLevel) updates.priceLevel = data.priceLevel;
    if (data.googlePlaceId && !existing.googlePlaceId) updates.googlePlaceId = data.googlePlaceId;
    if (data.googleTypes && (data.googleTypes as string[]).length > 0) {
      const existingGTypes = existing.googleTypes || [];
      const hasExistingSpecific = existingGTypes.some((t: string) =>
        t.includes('_restaurant') || t.includes('_shop') || t.includes('_house') || t.includes('_bar')
      );
      const hasNewSpecific = (data.googleTypes as string[]).some((t: string) =>
        t.includes('_restaurant') || t.includes('_shop') || t.includes('_house') || t.includes('_bar')
      );
      if (!hasExistingSpecific || hasNewSpecific) {
        if (existingGTypes.length === 0) {
          updates.googleTypes = data.googleTypes;
        } else if (hasNewSpecific) {
          const merged = new Set([...(data.googleTypes as string[]), ...existingGTypes]);
          updates.googleTypes = Array.from(merged);
        }
      }
    }
    if (data.googlePrimaryType && !existing.googlePrimaryType) {
      updates.googlePrimaryType = data.googlePrimaryType;
    }

    const gTypes = (updates.googleTypes as string[] | null) ?? existing.googleTypes ?? (data.googleTypes as string[] | null) ?? [];
    const incomingTags = (data.tags as string[] | null) ?? existing.tags ?? [];
    const gPrimary = (data.googlePrimaryType as string | null) ?? existing.googlePrimaryType;
    const { tags: enrichedTags, category: enrichedCategory } = applyTagEnrichment(
      existing.name,
      incomingTags,
      data.category as string | null,
      gTypes,
      gPrimary
    );
    if (JSON.stringify(enrichedTags) !== JSON.stringify(existing.tags)) {
      updates.tags = enrichedTags;
    }
    if (enrichedCategory !== existing.category) {
      updates.category = enrichedCategory;
    }

    if (existing.bucketSource !== "user_override") {
      const finalTypes = (updates.googleTypes as string[] | null) ?? existing.googleTypes;
      const finalPrimary = (updates.googlePrimaryType as string | null) ?? existing.googlePrimaryType;
      const classification = classifyVenue(existing.name, finalTypes, finalPrimary);
      if (classification.venueBucket !== existing.venueBucket) updates.venueBucket = classification.venueBucket;
      if (classification.isHybrid !== existing.isHybrid) updates.isHybrid = classification.isHybrid;
      if (classification.bucketSource !== existing.bucketSource) updates.bucketSource = classification.bucketSource;
      if (classification.bucketConfidence !== existing.bucketConfidence) updates.bucketConfidence = classification.bucketConfidence;
    }

    return updates;
  }

  async upsertRestaurant(data: InsertRestaurant): Promise<Restaurant> {
    if (data.googlePlaceId) {
      const existing = await this.getRestaurantByPlaceId(data.googlePlaceId);
      if (existing) {
        const updates = this.applyUpdates(existing, data);
        if (Object.keys(updates).length > 0) {
          const [updated] = await db.update(restaurants).set(updates).where(eq(restaurants.id, existing.id)).returning();
          return updated;
        }
        return existing;
      }
    }

    const [nameMatch] = await db.select().from(restaurants)
      .where(sql`LOWER(${restaurants.name}) = LOWER(${data.name})`)
      .limit(1);

    if (nameMatch) {
      const updates = this.applyUpdates(nameMatch, data);
      if (Object.keys(updates).length > 0) {
        const [updated] = await db.update(restaurants).set(updates).where(eq(restaurants.id, nameMatch.id)).returning();
        return updated;
      }
      return nameMatch;
    }

    return this.createRestaurant(data);
  }

  async backfillGoogleTypes(googlePlaceId: string, googleTypes: string[], googlePrimaryType: string | null): Promise<void> {
    const [existing] = await db.select().from(restaurants).where(eq(restaurants.googlePlaceId, googlePlaceId));
    if (!existing) return;

    const existingTypes = existing.googleTypes || [];
    const hasExistingSpecific = existingTypes.some((t: string) =>
      t.includes('_restaurant') || t.includes('_shop') || t.includes('_house') || t.includes('_bar') || t.includes('_deli') || t.includes('_diner') || t.includes('_cafe')
    );
    const hasNewSpecific = googleTypes.some((t: string) =>
      t.includes('_restaurant') || t.includes('_shop') || t.includes('_house') || t.includes('_bar') || t.includes('_deli') || t.includes('_diner') || t.includes('_cafe')
    );

    let mergedTypes: string[];
    if (hasExistingSpecific && !hasNewSpecific) {
      mergedTypes = existingTypes;
    } else if (hasNewSpecific) {
      const merged = new Set([...googleTypes, ...existingTypes]);
      mergedTypes = Array.from(merged);
    } else {
      mergedTypes = googleTypes;
    }

    const finalPrimaryType = googlePrimaryType || existing.googlePrimaryType;

    const { tags: enrichedTags, category: enrichedCategory } = applyTagEnrichment(
      existing.name,
      mergedTypes,
      null,
      mergedTypes,
      finalPrimaryType
    );

    await db.update(restaurants).set({
      googleTypes: mergedTypes,
      ...(finalPrimaryType ? { googlePrimaryType: finalPrimaryType } : {}),
      tags: enrichedTags,
      category: enrichedCategory,
    }).where(eq(restaurants.googlePlaceId, googlePlaceId));
  }

  async getAllRestaurantsWithPlaceIds(): Promise<Restaurant[]> {
    return db.select().from(restaurants).where(
      sql`${restaurants.googlePlaceId} IS NOT NULL`
    );
  }

  async syncUserRankings(userId: string, rankings: { restaurantId: string; rankPosition: number; listLength: number }[], bucket: VenueBucket = "restaurant"): Promise<void> {
    await db.delete(userRankings).where(
      and(eq(userRankings.userId, userId), eq(userRankings.bucket, bucket))
    );

    if (rankings.length > 0) {
      const values = rankings.map(r => ({
        userId,
        restaurantId: r.restaurantId,
        rankPosition: r.rankPosition,
        listLength: r.listLength,
        bucket,
      }));
      await db.insert(userRankings).values(values);
    }
  }

  async getUserRankings(userId: string, bucket?: VenueBucket): Promise<{ restaurant: Restaurant; rankPosition: number; listLength: number }[]> {
    const conditions = [eq(userRankings.userId, userId)];
    if (bucket) {
      conditions.push(eq(userRankings.bucket, bucket));
    }
    const rows = await db
      .select({
        restaurant: restaurants,
        rankPosition: userRankings.rankPosition,
        listLength: userRankings.listLength,
      })
      .from(userRankings)
      .innerJoin(restaurants, eq(userRankings.restaurantId, restaurants.id))
      .where(and(...conditions))
      .orderBy(userRankings.rankPosition);
    return rows;
  }

  async deleteUserRankings(userId: string, bucket?: VenueBucket): Promise<void> {
    const conditions = [eq(userRankings.userId, userId)];
    if (bucket) {
      conditions.push(eq(userRankings.bucket, bucket));
    }
    await db.delete(userRankings).where(and(...conditions));
  }

  async getRestaurantsWithoutCoordinates(): Promise<Restaurant[]> {
    return db.select().from(restaurants).where(
      and(
        sql`${restaurants.googlePlaceId} IS NOT NULL`,
        or(isNull(restaurants.lat), isNull(restaurants.lng))
      )
    );
  }

  async updateRestaurantCoordinates(id: string, lat: number, lng: number): Promise<void> {
    await db.update(restaurants).set({ lat, lng }).where(eq(restaurants.id, id));
  }

  async getRestaurantsWithoutImages(): Promise<Restaurant[]> {
    return db.select().from(restaurants).where(
      or(isNull(restaurants.image), sql`${restaurants.image} = ''`)
    );
  }

  async getRestaurantsWithoutGoogleTypes(): Promise<Restaurant[]> {
    return db.select().from(restaurants).where(
      and(
        sql`${restaurants.googlePlaceId} IS NOT NULL`,
        or(
          isNull(restaurants.googleTypes),
          sql`array_length(${restaurants.googleTypes}, 1) IS NULL`
        )
      )
    );
  }

  async updateRestaurantImage(id: string, image: string, googlePlaceId?: string): Promise<void> {
    const updates: Record<string, any> = { image };
    if (googlePlaceId) updates.googlePlaceId = googlePlaceId;
    await db.update(restaurants).set(updates).where(eq(restaurants.id, id));
  }

  async logPairwiseMatchup(matchup: InsertPairwiseMatchup): Promise<PairwiseMatchup> {
    const [row] = await db.insert(pairwiseMatchups).values(matchup).returning();
    return row;
  }

  async getMatchupsByPlaceId(placeId: string, limit: number = 50): Promise<PairwiseMatchup[]> {
    return db.select().from(pairwiseMatchups)
      .where(or(
        eq(pairwiseMatchups.winnerPlaceId, placeId),
        eq(pairwiseMatchups.loserPlaceId, placeId),
      ))
      .orderBy(desc(pairwiseMatchups.createdAt))
      .limit(limit);
  }

  async createGroup(name: string, userId: string, joinCode: string): Promise<Group> {
    const [group] = await db.insert(groups).values({
      name,
      createdByUserId: userId,
      joinCode,
    }).returning();
    await db.insert(groupMembers).values({
      groupId: group.id,
      userId,
      role: 'owner',
    });
    return group;
  }

  async getGroupById(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async getGroupByJoinCode(code: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.joinCode, code.toUpperCase()));
    return group;
  }

  async getGroupsByUserId(userId: string): Promise<(Group & { memberCount: number; role: string })[]> {
    const memberships = await db.select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    }).from(groupMembers).where(eq(groupMembers.userId, userId));

    if (memberships.length === 0) return [];

    const groupIds = memberships.map(m => m.groupId);
    const roleMap = new Map(memberships.map(m => [m.groupId, m.role]));

    const groupRows = await db.select().from(groups).where(inArray(groups.id, groupIds));

    const counts = await db.select({
      groupId: groupMembers.groupId,
      count: sql<number>`count(*)::int`,
    }).from(groupMembers)
      .where(inArray(groupMembers.groupId, groupIds))
      .groupBy(groupMembers.groupId);

    const countMap = new Map(counts.map(c => [c.groupId, c.count]));

    return groupRows.map(g => ({
      ...g,
      memberCount: countMap.get(g.id) ?? 0,
      role: roleMap.get(g.id) ?? 'member',
    }));
  }

  async getGroupMembers(groupId: string): Promise<(GroupMember & { displayName: string })[]> {
    const rows = await db.select({
      id: groupMembers.id,
      groupId: groupMembers.groupId,
      userId: groupMembers.userId,
      role: groupMembers.role,
      createdAt: groupMembers.createdAt,
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId));

    return rows.map(r => ({
      id: r.id,
      groupId: r.groupId,
      userId: r.userId,
      role: r.role,
      createdAt: r.createdAt,
      displayName: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'User',
    }));
  }

  async addGroupMember(groupId: string, userId: string, role: string): Promise<GroupMember> {
    const [member] = await db.insert(groupMembers).values({
      groupId,
      userId,
      role,
    }).returning();
    return member;
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await db.delete(groupMembers).where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
    );
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const [row] = await db.select({ id: groupMembers.id }).from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    return !!row;
  }

  async getGroupMemberUserIds(groupId: string): Promise<string[]> {
    const rows = await db.select({ userId: groupMembers.userId }).from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    return rows.map(r => r.userId);
  }

  async getCachedPlaceDetails(placeId: string): Promise<{ detailsJson: string; photoReference: string | null; fetchedAt: Date; isStale: boolean; photoData?: Buffer | null; photoContentType?: string | null } | undefined> {
    const [row] = await db.select().from(placeDetailsCache).where(eq(placeDetailsCache.googlePlaceId, placeId));
    if (!row) return undefined;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const isStale = row.fetchedAt < thirtyDaysAgo;
    return { 
      detailsJson: row.detailsJson, 
      photoReference: row.photoReference, 
      fetchedAt: row.fetchedAt, 
      isStale,
      photoData: row.photoData as Buffer | null,
      photoContentType: row.photoContentType
    };
  }

  async cachePlaceDetails(placeId: string, detailsJson: string, photoReference: string | null, photoData?: Buffer, photoContentType?: string): Promise<void> {
    // When no photoData is provided, explicitly set to null so stale binary
    // data from a previous photo reference doesn't persist after a refresh.
    const photoDataValue = photoData ?? null;
    const photoContentTypeValue = photoContentType ?? null;
    await db.insert(placeDetailsCache).values({
      googlePlaceId: placeId,
      detailsJson,
      photoReference,
      photoData: photoDataValue as any,
      photoContentType: photoContentTypeValue,
      fetchedAt: new Date(),
    }).onConflictDoUpdate({
      target: placeDetailsCache.googlePlaceId,
      set: {
        detailsJson,
        photoReference,
        photoData: photoDataValue as any,
        photoContentType: photoContentTypeValue,
        fetchedAt: new Date()
      },
    });
  }

async savePhotoToCache(placeId: string, photoData: Buffer, photoContentType: string): Promise<void> {
  const existing = await db.select({ googlePlaceId: placeDetailsCache.googlePlaceId })
    .from(placeDetailsCache)
    .where(eq(placeDetailsCache.googlePlaceId, placeId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(placeDetailsCache)
      .set({
        photoData: photoData as any,
        photoContentType,
      })
      .where(eq(placeDetailsCache.googlePlaceId, placeId));
  }
}

  async getPhotoFromCache(photoReference: string, placeId?: string): Promise<{ data: Buffer; contentType: string } | null> {
    // Try by photo reference first
    const [row] = await db.select({
      photoData: placeDetailsCache.photoData,
      photoContentType: placeDetailsCache.photoContentType
    })
    .from(placeDetailsCache)
    .where(eq(placeDetailsCache.photoReference, photoReference))
    .limit(1);

    if (row?.photoData && row?.photoContentType) {
      return { data: row.photoData as Buffer, contentType: row.photoContentType };
    }

    // No placeId fallback — the placeDetailsCache stores only the primary photo,
    // so a placeId lookup would return the hero image for every photo ref,
    // causing duplicate/wrong thumbnails.
    return null;
  }

  async clearCachedPlaceDetails(placeId: string): Promise<void> {
    await db.delete(placeDetailsCache).where(eq(placeDetailsCache.googlePlaceId, placeId));
  }

  async saveLeaderboardSnapshot(regionKey: string, entries: { restaurantId: string; position: number; score: number }[]): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date();

    const values = entries.map(e => ({
      regionKey,
      restaurantId: e.restaurantId,
      position: e.position,
      score: e.score,
      snapshotDate: now,
    }));
    const BATCH_SIZE = 500;
    for (let i = 0; i < values.length; i += BATCH_SIZE) {
      await db.insert(leaderboardSnapshots).values(values.slice(i, i + BATCH_SIZE));
    }

    await db.delete(leaderboardSnapshots).where(
      and(
        eq(leaderboardSnapshots.regionKey, regionKey),
        sql`${leaderboardSnapshots.snapshotDate} < (
          SELECT DISTINCT ${leaderboardSnapshots.snapshotDate} FROM ${leaderboardSnapshots}
          WHERE ${leaderboardSnapshots.regionKey} = ${regionKey}
          ORDER BY ${leaderboardSnapshots.snapshotDate} DESC
          LIMIT 1 OFFSET 1
        )`
      )
    ).catch(() => {});
  }

  async getLatestLeaderboardSnapshot(regionKey: string): Promise<{ restaurantId: string; position: number; snapshotDate: Date }[]> {
    const rows = await db.select({
      restaurantId: leaderboardSnapshots.restaurantId,
      position: leaderboardSnapshots.position,
      snapshotDate: leaderboardSnapshots.snapshotDate,
    })
    .from(leaderboardSnapshots)
    .where(
      and(
        eq(leaderboardSnapshots.regionKey, regionKey),
        sql`${leaderboardSnapshots.snapshotDate} = (
          SELECT DISTINCT ${leaderboardSnapshots.snapshotDate} FROM ${leaderboardSnapshots}
          WHERE ${leaderboardSnapshots.regionKey} = ${regionKey}
          ORDER BY ${leaderboardSnapshots.snapshotDate} DESC
          LIMIT 1
        )`
      )
    );
    return rows;
  }

  async getLeaderboardSnapshotDate(regionKey: string): Promise<Date | null> {
    const [row] = await db.select({
      maxDate: sql<Date>`MAX(${leaderboardSnapshots.snapshotDate})`,
    })
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.regionKey, regionKey));
    return row?.maxDate ?? null;
  }

  async saveUserRankingSnapshot(userId: string, entries: { restaurantId: string; position: number }[]): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date();

    const values = entries.map(e => ({
      userId,
      restaurantId: e.restaurantId,
      position: e.position,
      snapshotDate: now,
    }));
    const BATCH_SIZE = 500;
    for (let i = 0; i < values.length; i += BATCH_SIZE) {
      await db.insert(userRankingSnapshots).values(values.slice(i, i + BATCH_SIZE));
    }

    await db.delete(userRankingSnapshots).where(
      and(
        eq(userRankingSnapshots.userId, userId),
        sql`${userRankingSnapshots.snapshotDate} < (
          SELECT DISTINCT ${userRankingSnapshots.snapshotDate} FROM ${userRankingSnapshots}
          WHERE ${userRankingSnapshots.userId} = ${userId}
          ORDER BY ${userRankingSnapshots.snapshotDate} DESC
          LIMIT 1 OFFSET 1
        )`
      )
    ).catch(() => {});
  }

  async getLatestUserRankingSnapshot(userId: string): Promise<{ restaurantId: string; position: number; snapshotDate: Date }[]> {
    const rows = await db.select({
      restaurantId: userRankingSnapshots.restaurantId,
      position: userRankingSnapshots.position,
      snapshotDate: userRankingSnapshots.snapshotDate,
    })
    .from(userRankingSnapshots)
    .where(
      and(
        eq(userRankingSnapshots.userId, userId),
        sql`${userRankingSnapshots.snapshotDate} = (
          SELECT DISTINCT ${userRankingSnapshots.snapshotDate} FROM ${userRankingSnapshots}
          WHERE ${userRankingSnapshots.userId} = ${userId}
          ORDER BY ${userRankingSnapshots.snapshotDate} DESC
          LIMIT 1
        )`
      )
    );
    return rows;
  }

  async createRankingSession(data: {
    userId: string;
    queue: string[];
    currentIndex: number;
    currentPlaceId: string;
    insertionState: any;
    userRankingOrder: string[];
    status: string;
    bucket?: VenueBucket;
  }): Promise<RankingSession> {
    const [session] = await db.insert(rankingSessions).values({
      userId: data.userId,
      queue: data.queue,
      currentIndex: data.currentIndex,
      currentPlaceId: data.currentPlaceId,
      insertionState: data.insertionState,
      userRankingOrder: data.userRankingOrder,
      status: data.status,
      bucket: data.bucket ?? "restaurant",
    }).returning();
    return session;
  }

  async getActiveRankingSession(userId: string, bucket?: VenueBucket): Promise<RankingSession | undefined> {
    const conditions = [eq(rankingSessions.userId, userId), eq(rankingSessions.status, "active")];
    if (bucket) {
      conditions.push(eq(rankingSessions.bucket, bucket));
    }
    const [session] = await db.select().from(rankingSessions)
      .where(and(...conditions))
      .limit(1);
    return session;
  }

  async updateRankingSession(sessionId: string, updates: Partial<{
    status: string;
    currentIndex: number;
    currentPlaceId: string | null;
    insertionState: any;
    userRankingOrder: string[];
  }>): Promise<void> {
    const setData: any = { updatedAt: new Date() };
    if (updates.status !== undefined) setData.status = updates.status;
    if (updates.currentIndex !== undefined) setData.currentIndex = updates.currentIndex;
    if (updates.currentPlaceId !== undefined) setData.currentPlaceId = updates.currentPlaceId;
    if (updates.insertionState !== undefined) setData.insertionState = updates.insertionState;
    if (updates.userRankingOrder !== undefined) setData.userRankingOrder = updates.userRankingOrder;
    await db.update(rankingSessions).set(setData).where(eq(rankingSessions.id, sessionId));
  }

  async abandonActiveRankingSessions(userId: string, bucket?: VenueBucket): Promise<void> {
    const conditions = [eq(rankingSessions.userId, userId), eq(rankingSessions.status, "active")];
    if (bucket) {
      conditions.push(eq(rankingSessions.bucket, bucket));
    }
    await db.update(rankingSessions)
      .set({ status: "abandoned", updatedAt: new Date() })
      .where(and(...conditions));
  }

  async getSearchCache(cacheKey: string, allowStale: boolean = false): Promise<string | undefined> {
    const [row] = await db.select().from(placesSearchCache)
      .where(eq(placesSearchCache.cacheKey, cacheKey));
    if (!row) return undefined;
    if (!allowStale && row.expiresAt < new Date()) return undefined;
    return row.payloadJson;
  }

  async setSearchCache(cacheKey: string, payloadJson: string, ttlMs: number): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await db.insert(placesSearchCache).values({
      cacheKey,
      payloadJson,
      createdAt: now,
      expiresAt,
    }).onConflictDoUpdate({
      target: placesSearchCache.cacheKey,
      set: { payloadJson, createdAt: now, expiresAt },
    });
  }

  async cleanupExpiredSearchCache(): Promise<void> {
    await db.delete(placesSearchCache)
      .where(sql`${placesSearchCache.expiresAt} < NOW()`);
  }

  async createReport(userId: string, placeId: string, reason: string, message?: string | null): Promise<RestaurantReport> {
    const [report] = await db.insert(restaurantReports).values({ userId, placeId, reason, message: message || null }).returning();
    return report;
  }

  async getReportsByUser(userId: string): Promise<RestaurantReport[]> {
    return db.select().from(restaurantReports).where(eq(restaurantReports.userId, userId)).orderBy(desc(restaurantReports.createdAt));
  }

  async getOpenReports(limit: number, offset: number): Promise<RestaurantReport[]> {
    return db.select().from(restaurantReports).where(eq(restaurantReports.status, "open")).orderBy(desc(restaurantReports.createdAt)).limit(limit).offset(offset);
  }

  async resolveReport(id: string): Promise<void> {
    await db.update(restaurantReports).set({ status: "resolved", resolvedAt: new Date() }).where(eq(restaurantReports.id, id));
  }

  async createDeletionRequest(userId: string, message?: string | null): Promise<AccountDeletionRequest> {
    const [req] = await db.insert(accountDeletionRequests).values({ userId, message: message || null }).returning();
    return req;
  }

  async getOpenDeletionRequests(limit: number, offset: number): Promise<AccountDeletionRequest[]> {
    return db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.status, "open")).orderBy(desc(accountDeletionRequests.createdAt)).limit(limit).offset(offset);
  }

  async resolveDeletionRequest(id: string): Promise<void> {
    await db.update(accountDeletionRequests).set({ status: "resolved", resolvedAt: new Date() }).where(eq(accountDeletionRequests.id, id));
  }

  async completeDeletionRequest(id: string): Promise<void> {
    await db.update(accountDeletionRequests).set({ status: "completed", resolvedAt: new Date() }).where(eq(accountDeletionRequests.id, id));
  }

  async getDeletionRequestsByUser(userId: string): Promise<AccountDeletionRequest[]> {
    return db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, userId)).orderBy(desc(accountDeletionRequests.createdAt));
  }

  async getDeletionRequestById(id: string): Promise<AccountDeletionRequest | undefined> {
    const [req] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, id));
    return req;
  }

  async anonymizeUser(userId: string): Promise<void> {
    await db.update(users).set({
      email: `deleted_${userId}@take.invalid`,
      firstName: "Deleted",
      lastName: "User",
      profileImageUrl: null,
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
  }

  async getUserMatchupCount(userId: string): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(pairwiseMatchups).where(eq(pairwiseMatchups.userId, userId));
    return row?.count ?? 0;
  }

  async getUserSessionsSummary(userId: string): Promise<{ total: number; completed: number; abandoned: number }> {
    const rows = await db.select({ status: rankingSessions.status, count: sql<number>`count(*)::int` }).from(rankingSessions).where(eq(rankingSessions.userId, userId)).groupBy(rankingSessions.status);
    let total = 0, completed = 0, abandoned = 0;
    for (const r of rows) {
      total += r.count;
      if (r.status === "completed") completed += r.count;
      if (r.status === "abandoned") abandoned += r.count;
    }
    return { total, completed, abandoned };
  }

  async getWeeklySnapshot(regionKey: string, weekKey: string, scope: string = "overall"): Promise<{ restaurantId: string; position: number; score: number | null }[]> {
    return db.select({
      restaurantId: leaderboardSnapshots.restaurantId,
      position: leaderboardSnapshots.position,
      score: leaderboardSnapshots.score,
    })
    .from(leaderboardSnapshots)
    .where(
      and(
        eq(leaderboardSnapshots.regionKey, regionKey),
        eq(leaderboardSnapshots.snapshotWeek, weekKey),
        eq(leaderboardSnapshots.scope, scope),
      )
    )
    .orderBy(leaderboardSnapshots.position);
  }

  async saveWeeklySnapshot(regionKey: string, weekKey: string, scope: string, entries: { restaurantId: string; position: number; score: number }[]): Promise<void> {
    if (entries.length === 0) return;
    const existing = await this.getWeeklySnapshot(regionKey, weekKey, scope);
    if (existing.length > 0) return;
    const now = new Date();
    const values = entries.map(e => ({
      regionKey,
      restaurantId: e.restaurantId,
      position: e.position,
      score: e.score,
      snapshotDate: now,
      scope,
      snapshotWeek: weekKey,
    }));
    const BATCH_SIZE = 500;
    for (let i = 0; i < values.length; i += BATCH_SIZE) {
      try {
        await db.insert(leaderboardSnapshots).values(values.slice(i, i + BATCH_SIZE));
      } catch (err: any) {
        if (err?.code === '23505') return;
        throw err;
      }
    }
  }

  async getPreviousWeekSnapshot(regionKey: string, previousWeekKey: string, scope: string = "overall"): Promise<{ restaurantId: string; position: number; score: number | null }[]> {
    return db.select({
      restaurantId: leaderboardSnapshots.restaurantId,
      position: leaderboardSnapshots.position,
      score: leaderboardSnapshots.score,
    })
    .from(leaderboardSnapshots)
    .where(
      and(
        eq(leaderboardSnapshots.regionKey, regionKey),
        eq(leaderboardSnapshots.snapshotWeek, previousWeekKey),
        eq(leaderboardSnapshots.scope, scope),
      )
    )
    .orderBy(leaderboardSnapshots.position);
  }

  async updateLastWeeklyRecapSeen(userId: string): Promise<void> {
    await db.update(users).set({ lastWeeklyRecapSeenAt: new Date() }).where(eq(users.id, userId));
  }

  async getLastWeeklyRecapSeen(userId: string): Promise<Date | null> {
    const [row] = await db.select({ lastWeeklyRecapSeenAt: users.lastWeeklyRecapSeenAt }).from(users).where(eq(users.id, userId));
    return row?.lastWeeklyRecapSeenAt ?? null;
  }

  async createFollow(followerUserId: string, followedUserId: string): Promise<Follow> {
    const [row] = await db.insert(follows).values({ followerUserId, followedUserId }).onConflictDoNothing().returning();
    if (!row) {
      const [existing] = await db.select().from(follows).where(and(eq(follows.followerUserId, followerUserId), eq(follows.followedUserId, followedUserId)));
      return existing;
    }
    return row;
  }

  async deleteFollow(followerUserId: string, followedUserId: string): Promise<void> {
    await db.delete(follows).where(and(eq(follows.followerUserId, followerUserId), eq(follows.followedUserId, followedUserId)));
  }

  async getFollowing(userId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null }[]> {
    const rows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl })
      .from(follows)
      .innerJoin(users, eq(follows.followedUserId, users.id))
      .where(eq(follows.followerUserId, userId))
      .orderBy(desc(follows.createdAt));
    return rows;
  }

  async getFollowers(userId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null }[]> {
    const rows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl })
      .from(follows)
      .innerJoin(users, eq(follows.followerUserId, users.id))
      .where(eq(follows.followedUserId, userId))
      .orderBy(desc(follows.createdAt));
    return rows;
  }

  async isFollowing(followerUserId: string, followedUserId: string): Promise<boolean> {
    const [row] = await db.select({ id: follows.id }).from(follows).where(and(eq(follows.followerUserId, followerUserId), eq(follows.followedUserId, followedUserId)));
    return !!row;
  }

  async hasConnection(userA: string, userB: string): Promise<boolean> {
    const [row] = await db.select({ id: follows.id }).from(follows).where(
      or(
        and(eq(follows.followerUserId, userA), eq(follows.followedUserId, userB)),
        and(eq(follows.followerUserId, userB), eq(follows.followedUserId, userA)),
      )
    );
    return !!row;
  }

  async createInviteLink(userId: string, code: string, expiresAt: Date): Promise<InviteLink> {
    const [row] = await db.insert(inviteLinks).values({ code, createdByUserId: userId, expiresAt }).returning();
    return row;
  }

  async getInviteLinkByCode(code: string): Promise<InviteLink | undefined> {
    const [row] = await db.select().from(inviteLinks).where(eq(inviteLinks.code, code));
    return row;
  }

  async incrementInviteUses(id: string): Promise<void> {
    await db.update(inviteLinks).set({ uses: sql`${inviteLinks.uses} + 1` }).where(eq(inviteLinks.id, id));
  }

  async getUserRankingsRaw(userId: string, bucket?: VenueBucket): Promise<{ restaurantId: string; rankPosition: number }[]> {
    const conditions = [eq(userRankings.userId, userId)];
    if (bucket) conditions.push(eq(userRankings.bucket, bucket));
    return db.select({ restaurantId: userRankings.restaurantId, rankPosition: userRankings.rankPosition })
      .from(userRankings)
      .where(and(...conditions))
      .orderBy(userRankings.rankPosition);
  }
}

export const storage = new DatabaseStorage();
