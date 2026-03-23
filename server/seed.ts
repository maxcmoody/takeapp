import { db } from "./db";
import { restaurants, userRankings } from "@shared/schema";
import { sql, eq, like } from "drizzle-orm";
import { storage } from "./storage";
import { SEED_RESTAURANTS, SEED_RANKINGS } from "./seedData";

export async function seedDatabase(): Promise<void> {
  const existingRankings = await db.select({ count: sql<number>`count(*)` }).from(userRankings);
  const hasExistingData = Number(existingRankings[0].count) > 0;

  if (!hasExistingData) {
    console.log("No existing data, running full seed...");
  } else {
    console.log("Existing data found, re-syncing seed user rankings...");
  }

  const restaurantIdMap = new Map<string, string>();

  for (const r of SEED_RESTAURANTS) {
    const upserted = await storage.upsertRestaurant({
      name: r.name,
      googlePlaceId: r.googlePlaceId,
      image: r.image,
      tags: null,
      location: r.location,
      category: null,
      rating: r.rating,
      votes: null,
      priceLevel: r.priceLevel,
      lat: r.lat,
      lng: r.lng,
    });
    const key = r.googlePlaceId || r.name;
    restaurantIdMap.set(key, upserted.id);
  }

  const seedUserIds = Array.from(new Set(SEED_RANKINGS.map(r => r.userId)));

  for (const userId of seedUserIds) {
    const userRankingData = SEED_RANKINGS.filter(r => r.userId === userId);
    const dbRankings: { restaurantId: string; rankPosition: number; listLength: number }[] = [];

    for (const ranking of userRankingData) {
      const key = ranking.googlePlaceId || ranking.restaurantName;
      const restaurantId = restaurantIdMap.get(key);
      if (restaurantId) {
        dbRankings.push({
          restaurantId,
          rankPosition: ranking.rankPosition,
          listLength: ranking.listLength,
        });
      } else {
        console.warn(`Seed: could not find restaurant for key="${key}"`);
      }
    }

    if (dbRankings.length > 0) {
      await storage.syncUserRankings(userId, dbRankings);
    }
  }

  console.log(`Seeded ${SEED_RESTAURANTS.length} restaurants and ${seedUserIds.length} seed user rankings.`);
}
