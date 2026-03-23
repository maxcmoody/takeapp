import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, doublePrecision, index, timestamp, uniqueIndex, jsonb, boolean, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export type VenueBucket = "restaurant" | "bar";

export const restaurants = pgTable("restaurants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  googlePlaceId: text("google_place_id").unique(),
  image: text("image"),
  tags: text("tags").array(),
  location: text("location"),
  category: text("category"),
  rating: text("rating"),
  votes: text("votes"),
  priceLevel: text("price_level"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  googleTypes: text("google_types").array(),
  googlePrimaryType: text("google_primary_type"),
  venueBucket: text("venue_bucket").notNull().default("restaurant"),
  isHybrid: boolean("is_hybrid").notNull().default(false),
  bucketSource: text("bucket_source").notNull().default("auto"),
  bucketConfidence: text("bucket_confidence").notNull().default("low"),
});

export const insertRestaurantSchema = createInsertSchema(restaurants).pick({
  name: true,
  googlePlaceId: true,
  image: true,
  tags: true,
  location: true,
  category: true,
  rating: true,
  votes: true,
  priceLevel: true,
  lat: true,
  lng: true,
  googleTypes: true,
  googlePrimaryType: true,
  venueBucket: true,
  isHybrid: true,
  bucketSource: true,
  bucketConfidence: true,
});

export type InsertRestaurant = z.infer<typeof insertRestaurantSchema>;
export type Restaurant = typeof restaurants.$inferSelect;

export const userRankings = pgTable("user_rankings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id),
  rankPosition: integer("rank_position").notNull(),
  listLength: integer("list_length").notNull(),
  bucket: text("bucket").notNull().default("restaurant"),
}, (table) => [
  index("idx_user_rankings_user").on(table.userId),
  index("idx_user_rankings_restaurant").on(table.restaurantId),
  index("idx_user_rankings_user_restaurant").on(table.userId, table.restaurantId),
  index("idx_user_rankings_user_bucket").on(table.userId, table.bucket),
]);

export const insertUserRankingSchema = createInsertSchema(userRankings).pick({
  userId: true,
  restaurantId: true,
  rankPosition: true,
  listLength: true,
  bucket: true,
});

export type InsertUserRanking = z.infer<typeof insertUserRankingSchema>;
export type UserRanking = typeof userRankings.$inferSelect;

export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  joinCode: text("join_code").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGroupSchema = createInsertSchema(groups).pick({
  name: true,
});

export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groups.$inferSelect;

export const groupMembers = pgTable("group_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default('member'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_group_members_unique").on(table.groupId, table.userId),
  index("idx_group_members_user").on(table.userId),
  index("idx_group_members_group").on(table.groupId),
]);

export const insertGroupMemberSchema = createInsertSchema(groupMembers).pick({
  groupId: true,
  userId: true,
  role: true,
});

export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type GroupMember = typeof groupMembers.$inferSelect;

export const pairwiseMatchups = pgTable("pairwise_matchups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  winnerPlaceId: text("winner_place_id").notNull(),
  loserPlaceId: text("loser_place_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  contextTag: text("context_tag"),
  regionGeohash: text("region_geohash"),
  source: text("source").notNull(),
  sessionId: text("session_id"),
  bucket: text("bucket").notNull().default("restaurant"),
}, (table) => [
  index("idx_matchups_winner").on(table.winnerPlaceId),
  index("idx_matchups_loser").on(table.loserPlaceId),
  index("idx_matchups_user_created").on(table.userId, table.createdAt),
]);

export const insertPairwiseMatchupSchema = createInsertSchema(pairwiseMatchups).pick({
  userId: true,
  winnerPlaceId: true,
  loserPlaceId: true,
  contextTag: true,
  regionGeohash: true,
  source: true,
  sessionId: true,
  bucket: true,
});

export type InsertPairwiseMatchup = z.infer<typeof insertPairwiseMatchupSchema>;
export type PairwiseMatchup = typeof pairwiseMatchups.$inferSelect;

export const placeDetailsCache = pgTable("place_details_cache", {
  googlePlaceId: text("google_place_id").primaryKey(),
  detailsJson: text("details_json").notNull(),
  photoReference: text("photo_reference"),
  photoData: customType<{ data: Buffer; driverData: string }>({
    dataType() { return 'bytea'; },
  })("photo_data"),
  photoContentType: text("photo_content_type"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

export const placesSearchCache = pgTable("places_search_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("idx_places_search_cache_expires").on(table.expiresAt),
]);

export const leaderboardSnapshots = pgTable("leaderboard_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  regionKey: text("region_key").notNull(),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id),
  position: integer("position").notNull(),
  score: doublePrecision("score"),
  snapshotDate: timestamp("snapshot_date").notNull(),
  scope: text("scope").default("overall"),
  snapshotWeek: text("snapshot_week"),
}, (table) => [
  index("idx_lb_snap_region_date").on(table.regionKey, table.snapshotDate),
  index("idx_lb_snap_restaurant").on(table.restaurantId),
  index("idx_lb_snap_region_week_scope").on(table.regionKey, table.snapshotWeek, table.scope),
]);

export type LeaderboardSnapshot = typeof leaderboardSnapshots.$inferSelect;

export const userRankingSnapshots = pgTable("user_ranking_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id),
  position: integer("position").notNull(),
  snapshotDate: timestamp("snapshot_date").notNull(),
}, (table) => [
  index("idx_ur_snap_user_date").on(table.userId, table.snapshotDate),
]);

export type UserRankingSnapshot = typeof userRankingSnapshots.$inferSelect;

export const rankingSessions = pgTable("ranking_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("active"),
  queue: text("queue").array().notNull(),
  currentIndex: integer("current_index").notNull().default(0),
  currentPlaceId: text("current_place_id"),
  insertionState: jsonb("insertion_state"),
  userRankingOrder: text("user_ranking_order").array().notNull().default(sql`'{}'::text[]`),
  bucket: text("bucket").notNull().default("restaurant"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ranking_sessions_user_status").on(table.userId, table.status),
]);

export type RankingSession = typeof rankingSessions.$inferSelect;
export type InsertRankingSession = typeof rankingSessions.$inferInsert;

export const analyticsEvents = pgTable("analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventName: text("event_name").notNull(),
  userId: text("user_id"),
  properties: jsonb("properties"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_analytics_event_name").on(table.eventName),
  index("idx_analytics_created_at").on(table.createdAt),
]);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEvents.$inferInsert;

export const restaurantReports = pgTable("restaurant_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  placeId: text("place_id").notNull(),
  reason: text("reason").notNull(),
  message: text("message"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("idx_reports_status").on(table.status),
  index("idx_reports_user").on(table.userId),
]);

export type RestaurantReport = typeof restaurantReports.$inferSelect;

export const accountDeletionRequests = pgTable("account_deletion_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  message: text("message"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("idx_deletion_status").on(table.status),
]);

export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;

export const follows = pgTable("follows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  followerUserId: text("follower_user_id").notNull(),
  followedUserId: text("followed_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_follows_unique").on(table.followerUserId, table.followedUserId),
  index("idx_follows_follower").on(table.followerUserId),
  index("idx_follows_followed").on(table.followedUserId),
]);

export type Follow = typeof follows.$inferSelect;

export const inviteLinks = pgTable("invite_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  createdByUserId: text("created_by_user_id").notNull(),
  uses: integer("uses").notNull().default(0),
  maxUses: integer("max_uses").notNull().default(25),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_invite_links_creator").on(table.createdByUserId),
]);

export type InviteLink = typeof inviteLinks.$inferSelect;
export const userIdMappings = pgTable("user_id_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  oldUserId: text("old_user_id").notNull().unique(),
  newUserId: text("new_user_id").notNull().unique(),
  migratedAt: timestamp("migrated_at").defaultNow().notNull(),
});

export type UserIdMapping = typeof userIdMappings.$inferSelect;
export * from "./models/auth";
