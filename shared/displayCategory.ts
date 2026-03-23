const GENERIC_GOOGLE_TYPES = new Set([
  'restaurant', 'food', 'point_of_interest', 'establishment',
  'store', 'meal_takeaway', 'meal_delivery',
]);

const GOOGLE_TYPE_TO_LABEL: Record<string, string> = {
  'italian_restaurant': 'Italian',
  'pizza_restaurant': 'Pizza',
  'mexican_restaurant': 'Mexican',
  'chinese_restaurant': 'Chinese',
  'japanese_restaurant': 'Japanese',
  'korean_restaurant': 'Korean',
  'thai_restaurant': 'Thai',
  'vietnamese_restaurant': 'Vietnamese',
  'indian_restaurant': 'Indian',
  'greek_restaurant': 'Greek',
  'mediterranean_restaurant': 'Mediterranean',
  'turkish_restaurant': 'Turkish',
  'lebanese_restaurant': 'Lebanese',
  'french_restaurant': 'French',
  'spanish_restaurant': 'Spanish',
  'brazilian_restaurant': 'Brazilian',
  'peruvian_restaurant': 'Peruvian',
  'caribbean_restaurant': 'Caribbean',
  'middle_eastern_restaurant': 'Middle Eastern',
  'african_restaurant': 'African',
  'seafood_restaurant': 'Seafood',
  'steak_house': 'Steakhouse',
  'barbecue_restaurant': 'BBQ',
  'american_restaurant': 'American',
  'hamburger_restaurant': 'Burgers',
  'breakfast_restaurant': 'Breakfast',
  'brunch_restaurant': 'Brunch',
  'sandwich_shop': 'Sandwiches',
  'coffee_shop': 'Coffee & Cafe',
  'cafe': 'Cafe',
  'bakery': 'Bakery',
  'bar': 'Bar',
  'pub': 'Pub',
  'wine_bar': 'Wine Bar',
  'ice_cream_shop': 'Ice Cream',
  'dessert_shop': 'Dessert',
  'ramen_restaurant': 'Ramen',
  'sushi_restaurant': 'Sushi',
  'vegan_restaurant': 'Vegan',
  'vegetarian_restaurant': 'Vegetarian',
  'fast_food_restaurant': 'Fast Food',
  'fine_dining_restaurant': 'Fine Dining',
  'deli': 'Deli',
  'diner': 'Diner',
  'butcher_shop': 'Butcher Shop',
  'food_store': 'Food Store',
  'night_club': 'Nightclub',
  'cocktail_bar': 'Cocktail Bar',
  'sports_bar': 'Sports Bar',
  'beer_hall': 'Beer Hall',
  'beer_garden': 'Beer Garden',
  'food_delivery': 'Delivery',
  'catering_service': 'Catering',
  'event_venue': 'Event Venue',
};

const LOW_PRIORITY_LABELS = new Set([
  'Catering', 'Delivery', 'Event Venue', 'Food Store',
]);

export function getDisplayCategoryLabel(
  googleTypes?: string[] | null,
  googlePrimaryType?: string | null,
  fallbackCategory?: string | null,
): string {
  if (googlePrimaryType && !GENERIC_GOOGLE_TYPES.has(googlePrimaryType)) {
    const label = GOOGLE_TYPE_TO_LABEL[googlePrimaryType];
    if (label) return label;
  }

  if (googleTypes && googleTypes.length > 0) {
    let lowPriorityLabel: string | null = null;
    for (const gType of googleTypes) {
      if (GENERIC_GOOGLE_TYPES.has(gType)) continue;
      const label = GOOGLE_TYPE_TO_LABEL[gType];
      if (label) {
        if (LOW_PRIORITY_LABELS.has(label)) {
          if (!lowPriorityLabel) lowPriorityLabel = label;
          continue;
        }
        return label;
      }
    }
    if (lowPriorityLabel) return lowPriorityLabel;
  }

  if (fallbackCategory && fallbackCategory.toLowerCase() !== 'restaurant') {
    return fallbackCategory;
  }

  return 'Restaurant';
}

export function getSecondaryCategoryLabel(
  googleTypes?: string[] | null,
  googlePrimaryType?: string | null,
): string | null {
  if (!googleTypes || googleTypes.length < 2) return null;

  const primary = getDisplayCategoryLabel(googleTypes, googlePrimaryType);
  const seen = new Set([primary]);

  for (const gType of googleTypes) {
    if (GENERIC_GOOGLE_TYPES.has(gType)) continue;
    const label = GOOGLE_TYPE_TO_LABEL[gType];
    if (label && !seen.has(label) && !LOW_PRIORITY_LABELS.has(label)) {
      return label;
    }
  }
  return null;
}
