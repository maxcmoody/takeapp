export interface TagMapping {
  googleTypes: string[];
  keywords: string[];
}

export const TAG_TO_GOOGLE_TYPES: Record<string, TagMapping> = {
  pizza: {
    googleTypes: ["pizza_restaurant", "pizza_delivery"],
    keywords: ["pizza"],
  },
  burgers: {
    googleTypes: ["hamburger_restaurant"],
    keywords: ["burger", "burgers"],
  },
  mexican: {
    googleTypes: ["mexican_restaurant"],
    keywords: ["mexican", "taco", "taqueria", "burrito", "enchilada"],
  },
  seafood: {
    googleTypes: ["seafood_restaurant"],
    keywords: ["seafood", "fish", "oyster", "shrimp", "crab", "lobster", "sushi"],
  },
  bbq: {
    googleTypes: ["barbecue_restaurant"],
    keywords: ["bbq", "barbecue", "barbeque", "smokehouse", "smoked"],
  },
  italian: {
    googleTypes: ["italian_restaurant"],
    keywords: ["italian", "pasta", "trattoria", "ristorante", "pizzeria"],
  },
  asian: {
    googleTypes: ["chinese_restaurant", "japanese_restaurant", "korean_restaurant", "thai_restaurant", "vietnamese_restaurant", "asian_restaurant", "ramen_restaurant", "sushi_restaurant"],
    keywords: ["chinese", "japanese", "korean", "thai", "vietnamese", "asian", "ramen", "pho", "wok", "teriyaki", "dim sum"],
  },
  breakfast: {
    googleTypes: ["breakfast_restaurant", "brunch_restaurant"],
    keywords: ["breakfast", "brunch", "pancake", "waffle", "diner"],
  },
  coffee: {
    googleTypes: ["cafe", "coffee_shop"],
    keywords: ["coffee", "cafe", "espresso", "latte"],
  },
  southern: {
    googleTypes: ["american_restaurant"],
    keywords: ["southern", "soul food", "fried chicken", "grits", "cajun", "creole"],
  },
  bar: {
    googleTypes: ["bar", "wine_bar", "cocktail_bar", "pub", "sports_bar", "beer_hall", "beer_garden", "night_club"],
    keywords: ["bar", "pub", "tavern", "brewery", "brewing", "taproom", "taphouse", "saloon"],
  },
  sandwich: {
    googleTypes: ["sandwich_shop"],
    keywords: ["sandwich", "deli", "sub", "hoagie"],
  },
  sushi: {
    googleTypes: ["sushi_restaurant"],
    keywords: ["sushi"],
  },
  indian: {
    googleTypes: ["indian_restaurant"],
    keywords: ["indian", "curry", "tandoori", "masala"],
  },
  greek: {
    googleTypes: ["greek_restaurant"],
    keywords: ["greek", "gyro", "souvlaki"],
  },
  mediterranean: {
    googleTypes: ["mediterranean_restaurant", "lebanese_restaurant", "middle_eastern_restaurant"],
    keywords: ["mediterranean", "falafel", "hummus", "kebab", "shawarma"],
  },
  steakhouse: {
    googleTypes: ["steak_house"],
    keywords: ["steak", "steakhouse"],
  },
  vegan: {
    googleTypes: ["vegan_restaurant", "vegetarian_restaurant"],
    keywords: ["vegan", "vegetarian", "plant-based"],
  },
};

export function getGoogleTypesForTag(tag: string): string[] {
  const mapping = TAG_TO_GOOGLE_TYPES[tag.toLowerCase()];
  return mapping?.googleTypes ?? [];
}

export function getKeywordsForTag(tag: string): string[] {
  const mapping = TAG_TO_GOOGLE_TYPES[tag.toLowerCase()];
  return mapping?.keywords ?? [];
}

export function matchesTag(tag: string, googleTypes: string[] | null, googlePrimaryType: string | null): boolean {
  const mapping = TAG_TO_GOOGLE_TYPES[tag.toLowerCase()];
  if (!mapping) return false;

  const types = googleTypes || [];
  const primary = googlePrimaryType || '';

  for (const gType of mapping.googleTypes) {
    if (types.includes(gType) || primary === gType) return true;
  }

  return false;
}
