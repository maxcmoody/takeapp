import type { VenueBucket } from "@shared/schema";

const BAR_TYPES = new Set([
  "bar",
  "night_club",
  "wine_bar",
  "cocktail_bar",
  "sports_bar",
  "beer_garden",
  "pub",
  "brewery",
  "liquor_store",
]);

const RESTAURANT_TYPES = new Set([
  "restaurant",
  "meal_delivery",
  "meal_takeaway",
  "food",
  "bakery",
  "cafe",
  "coffee_shop",
  "ice_cream_shop",
  "pizza_restaurant",
  "hamburger_restaurant",
  "seafood_restaurant",
  "steak_house",
  "sushi_restaurant",
  "ramen_restaurant",
  "chinese_restaurant",
  "indian_restaurant",
  "italian_restaurant",
  "japanese_restaurant",
  "korean_restaurant",
  "mexican_restaurant",
  "thai_restaurant",
  "turkish_restaurant",
  "vietnamese_restaurant",
  "indonesian_restaurant",
  "french_restaurant",
  "greek_restaurant",
  "lebanese_restaurant",
  "mediterranean_restaurant",
  "middle_eastern_restaurant",
  "spanish_restaurant",
  "american_restaurant",
  "brazilian_restaurant",
  "brunch_restaurant",
  "sandwich_shop",
  "fast_food_restaurant",
  "vegan_restaurant",
  "vegetarian_restaurant",
]);

const HYBRID_NAME_PATTERNS = [
  /\bgastropub\b/i,
  /\bbrew\s*pub\b/i,
  /\btaphouse\b/i,
  /\btap\s*room\b/i,
  /\bbar\s*(?:&|and)\s*grill\b/i,
  /\bgrill\s*(?:&|and)\s*bar\b/i,
  /\bpub\s*(?:&|and)\s*grill\b/i,
  /\bkitchen\s*(?:&|and)\s*bar\b/i,
  /\bbar\s*(?:&|and)\s*kitchen\b/i,
  /\bale\s*house\b/i,
  /\bbeer\s*hall\b/i,
  /\bbiergarten\b/i,
];

const BAR_NAME_PATTERNS = [
  /\bbar\b/i,
  /\bpub\b/i,
  /\btavern\b/i,
  /\blounge\b/i,
  /\bbrewery\b/i,
  /\btaproom\b/i,
  /\bwine\s*bar\b/i,
  /\bcocktail\b/i,
  /\bspeakeasy\b/i,
  /\bbeer\b/i,
  /\bsaloon\b/i,
];

export interface ClassificationResult {
  venueBucket: VenueBucket;
  isHybrid: boolean;
  bucketSource: string;
  bucketConfidence: string;
}

export function classifyVenue(
  name: string,
  googleTypes?: string[] | null,
  googlePrimaryType?: string | null
): ClassificationResult {
  const types = googleTypes ?? [];
  const primaryType = googlePrimaryType ?? null;

  const hasBarType = types.some(t => BAR_TYPES.has(t));
  const hasRestaurantType = types.some(t => RESTAURANT_TYPES.has(t));
  const primaryIsBar = primaryType ? BAR_TYPES.has(primaryType) : false;
  const primaryIsRestaurant = primaryType ? RESTAURANT_TYPES.has(primaryType) : false;

  const nameIsHybrid = HYBRID_NAME_PATTERNS.some(p => p.test(name));
  const nameIsBar = BAR_NAME_PATTERNS.some(p => p.test(name));

  if (hasBarType && hasRestaurantType) {
    const bucket: VenueBucket = primaryIsBar ? "bar" : "restaurant";
    return {
      venueBucket: bucket,
      isHybrid: true,
      bucketSource: "google",
      bucketConfidence: "high",
    };
  }

  if (nameIsHybrid) {
    return {
      venueBucket: hasBarType ? "bar" : "restaurant",
      isHybrid: true,
      bucketSource: "heuristic",
      bucketConfidence: "med",
    };
  }

  if (hasBarType && !hasRestaurantType) {
    return {
      venueBucket: "bar",
      isHybrid: false,
      bucketSource: "google",
      bucketConfidence: primaryIsBar ? "high" : "med",
    };
  }

  if (hasRestaurantType && !hasBarType) {
    return {
      venueBucket: "restaurant",
      isHybrid: nameIsBar,
      bucketSource: "google",
      bucketConfidence: primaryIsRestaurant ? "high" : "med",
    };
  }

  if (nameIsBar && !nameIsHybrid) {
    return {
      venueBucket: "bar",
      isHybrid: false,
      bucketSource: "heuristic",
      bucketConfidence: "low",
    };
  }

  return {
    venueBucket: "restaurant",
    isHybrid: false,
    bucketSource: "auto",
    bucketConfidence: "low",
  };
}
