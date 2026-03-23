import { clerkMiddleware, getAuth } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import { authStorage } from "./replit_integrations/auth/storage";
import { db } from "./db";
import { userIdMappings, userRankings, pairwiseMatchups, rankingSessions, groups, groupMembers, follows, inviteLinks, userRankingSnapshots, analyticsEvents, restaurantReports, accountDeletionRequests, users } from "@shared/schema";
import { eq } from "drizzle-orm";

export function setupClerkAuth(app: Express) {
  const isDev = process.env.NODE_ENV !== "production";
  const devPublishableKey = process.env.CLERK_DEV_PUBLISHABLE_KEY;
  const devSecretKey = process.env.CLERK_DEV_SECRET_KEY;

  if (isDev && devPublishableKey && devSecretKey) {
    app.use(clerkMiddleware({ publishableKey: devPublishableKey, secretKey: devSecretKey }));
  } else {
    app.use(clerkMiddleware());
  }
}

async function migrateUserIfNeeded(clerkUserId: string, email: string | null): Promise<void> {
  if (!email) return;

  const existingMapping = await db.select().from(userIdMappings).where(eq(userIdMappings.newUserId, clerkUserId));
  if (existingMapping.length > 0) return;

  const oldUsers = await db.select().from(users).where(eq(users.email, email));
  if (oldUsers.length === 0) return;

  const oldUserId = oldUsers[0].id;
  if (oldUserId === clerkUserId) return;

  const mappingByOldId = await db.select().from(userIdMappings).where(eq(userIdMappings.oldUserId, String(oldUserId)));
  if (mappingByOldId.length > 0) {
    const previousNewId = mappingByOldId[0].newUserId;
    if (previousNewId === clerkUserId) {
      return;
    }
    console.log(`[migration] Re-migrating user data from ${previousNewId} -> ${clerkUserId} (previously migrated from ${oldUserId})`);
    await db.transaction(async (tx) => {
      await tx.update(userRankings).set({ userId: clerkUserId }).where(eq(userRankings.userId, previousNewId));
      await tx.update(pairwiseMatchups).set({ userId: clerkUserId }).where(eq(pairwiseMatchups.userId, previousNewId));
      await tx.update(rankingSessions).set({ userId: clerkUserId }).where(eq(rankingSessions.userId, previousNewId));
      await tx.update(groups).set({ createdByUserId: clerkUserId }).where(eq(groups.createdByUserId, previousNewId));
      await tx.update(groupMembers).set({ userId: clerkUserId }).where(eq(groupMembers.userId, previousNewId));
      await tx.update(follows).set({ followerUserId: clerkUserId }).where(eq(follows.followerUserId, previousNewId));
      await tx.update(follows).set({ followedUserId: clerkUserId }).where(eq(follows.followedUserId, previousNewId));
      await tx.update(inviteLinks).set({ createdByUserId: clerkUserId }).where(eq(inviteLinks.createdByUserId, previousNewId));
      await tx.update(userRankingSnapshots).set({ userId: clerkUserId }).where(eq(userRankingSnapshots.userId, previousNewId));
      await tx.update(analyticsEvents).set({ userId: clerkUserId }).where(eq(analyticsEvents.userId, previousNewId));
      await tx.update(restaurantReports).set({ userId: clerkUserId }).where(eq(restaurantReports.userId, previousNewId));
      await tx.update(accountDeletionRequests).set({ userId: clerkUserId }).where(eq(accountDeletionRequests.userId, previousNewId));
      await tx.update(userIdMappings).set({ newUserId: clerkUserId }).where(eq(userIdMappings.oldUserId, String(oldUserId)));
    });
    console.log(`[migration] Done re-migrating ${previousNewId} -> ${clerkUserId}`);
    return;
  }

  console.log(`[migration] Migrating user ${oldUserId} -> ${clerkUserId}`);

  await db.transaction(async (tx) => {
    await tx.update(userRankings).set({ userId: clerkUserId }).where(eq(userRankings.userId, String(oldUserId)));
    await tx.update(pairwiseMatchups).set({ userId: clerkUserId }).where(eq(pairwiseMatchups.userId, String(oldUserId)));
    await tx.update(rankingSessions).set({ userId: clerkUserId }).where(eq(rankingSessions.userId, String(oldUserId)));
    await tx.update(groups).set({ createdByUserId: clerkUserId }).where(eq(groups.createdByUserId, String(oldUserId)));
    await tx.update(groupMembers).set({ userId: clerkUserId }).where(eq(groupMembers.userId, String(oldUserId)));
    await tx.update(follows).set({ followerUserId: clerkUserId }).where(eq(follows.followerUserId, String(oldUserId)));
    await tx.update(follows).set({ followedUserId: clerkUserId }).where(eq(follows.followedUserId, String(oldUserId)));
    await tx.update(inviteLinks).set({ createdByUserId: clerkUserId }).where(eq(inviteLinks.createdByUserId, String(oldUserId)));
    await tx.update(userRankingSnapshots).set({ userId: clerkUserId }).where(eq(userRankingSnapshots.userId, String(oldUserId)));
    await tx.update(analyticsEvents).set({ userId: clerkUserId }).where(eq(analyticsEvents.userId, String(oldUserId)));
    await tx.update(restaurantReports).set({ userId: clerkUserId }).where(eq(restaurantReports.userId, String(oldUserId)));
    await tx.update(accountDeletionRequests).set({ userId: clerkUserId }).where(eq(accountDeletionRequests.userId, String(oldUserId)));

    await tx.insert(userIdMappings).values({ oldUserId: String(oldUserId), newUserId: clerkUserId });
  });

  console.log(`[migration] Done migrating ${oldUserId} -> ${clerkUserId}`);
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);

  if (!auth.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  (req as any).user = {
    claims: {
      sub: auth.userId,
    },
  };

  try {
    // Check if user already exists locally — if so, skip the Clerk API call
    const existingUser = await authStorage.getUser(auth.userId);

   if (!existingUser) {
      // New user — fetch from Clerk and save locally
      const { clerkClient, createClerkClient } = await import("@clerk/express");
      const isDev = process.env.NODE_ENV !== "production";
      const devSecretKey = process.env.CLERK_DEV_SECRET_KEY;
      const client = (isDev && devSecretKey) ? createClerkClient({ secretKey: devSecretKey }) : clerkClient;
      const clerkUser = await client.users.getUser(auth.userId);
      const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;

      await migrateUserIfNeeded(auth.userId, email);

      await authStorage.upsertUser({
        id: auth.userId,
        email,
        firstName: clerkUser.firstName || null,
        lastName: clerkUser.lastName || null,
        profileImageUrl: clerkUser.imageUrl || null,
      });
    }
  } catch (e) {
    console.error("[clerkAuth] Error upserting user:", e);
  }

  return next();
};
