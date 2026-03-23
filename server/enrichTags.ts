import { db } from "./db";
import { restaurants } from "@shared/schema";
import { enrichTags, inferCategory } from "@shared/tagInference";
import { eq } from "drizzle-orm";

export async function enrichExistingTags() {
  const allRestaurants = await db.select().from(restaurants);
  let updated = 0;

  for (const r of allRestaurants) {
    const currentTags = r.tags || [];
    const googleTypes = r.googleTypes || [];
    const gTypes = googleTypes.length > 0 ? googleTypes : undefined;

    const newTags = enrichTags(r.name, currentTags.length > 0 ? currentTags : googleTypes, gTypes);
    const newCategory = inferCategory(r.name, newTags, gTypes, r.googlePrimaryType || undefined);

    const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(currentTags);
    const categoryChanged = newCategory !== r.category;

    if (tagsChanged || categoryChanged) {
      const updates: Record<string, any> = {};
      if (tagsChanged) updates.tags = newTags;
      if (categoryChanged) updates.category = newCategory;

      await db.update(restaurants)
        .set(updates)
        .where(eq(restaurants.id, r.id));
      updated++;
      if (tagsChanged) {
        console.log(`  Enriched "${r.name}": [${currentTags.join(', ')}] → [${newTags.join(', ')}] (${newCategory})`);
      } else {
        console.log(`  Fixed category "${r.name}": ${r.category} → ${newCategory}`);
      }
    }
  }

  if (updated > 0) {
    console.log(`Updated ${updated} restaurants.`);
  } else {
    console.log("All restaurants already have proper tags and categories.");
  }
}
