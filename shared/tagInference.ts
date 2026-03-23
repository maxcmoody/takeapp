export const CUISINE_LABELS: Record<string, string> = {
  'pizza': 'Pizza',
  'burgers': 'Burgers',
  'mexican': 'Mexican',
  'seafood': 'Seafood',
  'bbq': 'BBQ',
  'italian': 'Italian',
  'asian': 'Asian',
  'chinese': 'Chinese',
  'japanese': 'Japanese',
  'korean': 'Korean',
  'thai': 'Thai',
  'vietnamese': 'Vietnamese',
  'breakfast': 'Breakfast',
  'coffee': 'Coffee & Cafe',
  'southern': 'Southern',
  'bar': 'Bars & Drinks',
  'sandwich': 'Sandwiches',
  'steakhouse': 'Steakhouse',
  'wings': 'Wings',
  'indian': 'Indian',
  'mediterranean': 'Mediterranean',
  'greek': 'Greek',
  'fine_dining': 'Fine Dining',
  'american': 'American',
  'bakery': 'Bakery',
  'french': 'French',
  'spanish': 'Spanish',
  'caribbean': 'Caribbean',
  'middle_eastern': 'Middle Eastern',
  'african': 'African',
  'brazilian': 'Brazilian',
  'peruvian': 'Peruvian',
  'ramen': 'Ramen',
  'sushi': 'Sushi',
  'ice_cream': 'Ice Cream',
  'dessert': 'Dessert',
  'vegan': 'Vegan',
  'vegetarian': 'Vegetarian',
  'pub': 'Pub',
  'cafe': 'Cafe',
  'brunch': 'Brunch',
  'deli': 'Deli',
  'diner': 'Diner',
  'fast_food': 'Fast Food',
  'food_truck': 'Food Truck',
  'wine_bar': 'Wine Bar',
  'butcher_shop': 'Butcher Shop',
  'event_venue': 'Event Venue',
  'food_store': 'Food Store',
  'catering_service': 'Catering',
  'food_delivery': 'Delivery',
};

const GOOGLE_TYPE_TO_TAG: Record<string, string> = {
  'italian_restaurant': 'italian',
  'pizza_restaurant': 'pizza',
  'mexican_restaurant': 'mexican',
  'chinese_restaurant': 'chinese',
  'japanese_restaurant': 'japanese',
  'korean_restaurant': 'korean',
  'thai_restaurant': 'thai',
  'vietnamese_restaurant': 'vietnamese',
  'indian_restaurant': 'indian',
  'greek_restaurant': 'greek',
  'mediterranean_restaurant': 'mediterranean',
  'turkish_restaurant': 'mediterranean',
  'lebanese_restaurant': 'middle_eastern',
  'french_restaurant': 'french',
  'seafood_restaurant': 'seafood',
  'steak_house': 'steakhouse',
  'barbecue_restaurant': 'bbq',
  'american_restaurant': 'american',
  'hamburger_restaurant': 'burgers',
  'breakfast_restaurant': 'breakfast',
  'brunch_restaurant': 'brunch',
  'sandwich_shop': 'sandwich',
  'coffee_shop': 'coffee',
  'cafe': 'cafe',
  'bakery': 'bakery',
  'bar': 'bar',
  'pub': 'pub',
  'ice_cream_shop': 'ice_cream',
  'dessert_shop': 'dessert',
  'ramen_restaurant': 'ramen',
  'sushi_restaurant': 'sushi',
  'vegan_restaurant': 'vegan',
  'vegetarian_restaurant': 'vegetarian',
  'spanish_restaurant': 'spanish',
  'brazilian_restaurant': 'brazilian',
  'peruvian_restaurant': 'peruvian',
  'caribbean_restaurant': 'caribbean',
  'middle_eastern_restaurant': 'middle_eastern',
  'african_restaurant': 'african',
  'taco_restaurant': 'mexican',
  'fast_food_restaurant': 'fast_food',
  'fine_dining_restaurant': 'fine_dining',
  'deli': 'deli',
  'diner': 'diner',
  'wine_bar': 'wine_bar',
  'butcher_shop': 'butcher_shop',
  'event_venue': 'event_venue',
  'food_store': 'food_store',
  'catering_service': 'catering_service',
  'food_delivery': 'food_delivery',
};

const GENERIC_TAGS = ['restaurant', 'food', 'point_of_interest', 'establishment', 'meal_delivery', 'meal_takeaway', 'museum', 'night_club', 'tourist_attraction', 'lodging', 'gym', 'health', 'church', 'park', 'gas_station', 'parking', 'car_wash', 'atm', 'bank', 'post_office', 'library', 'school', 'university', 'hospital', 'pharmacy', 'dentist', 'doctor', 'spa', 'beauty_salon', 'hair_care', 'laundry', 'storage', 'moving_company', 'real_estate_agency', 'travel_agency', 'insurance_agency', 'accounting', 'lawyer', 'electrician', 'plumber', 'painter', 'roofing_contractor', 'general_contractor', 'car_dealer', 'car_rental', 'car_repair'];

const NAME_KEYWORD_TO_TAG: [RegExp, string][] = [
  [/burger/i, 'burgers'],
  [/pizza/i, 'pizza'],
  [/taco|taqueria|tortilla/i, 'mexican'],
  [/wing(?:s|z)\b/i, 'wings'],
  [/\bbbq\b|barbecue|barbeque|smokehouse/i, 'bbq'],
  [/sushi/i, 'sushi'],
  [/ramen/i, 'ramen'],
  [/pho\b|banh\s?mi/i, 'vietnamese'],
  [/\bwok\b|dim\s?sum/i, 'chinese'],
  [/gyro|falafel|shawarma|kebab/i, 'mediterranean'],
  [/\bdeli\b/i, 'deli'],
  [/donut|doughnut/i, 'bakery'],
  [/\bcafe\b|café|coffee/i, 'coffee'],
  [/ice\s?cream|gelato|frozen\s?yogurt|froyo/i, 'ice_cream'],
  [/\bpub\b|taphouse|ale\s?house/i, 'pub'],
  [/\bbar\b|cantina|tavern|saloon|taproom|brewery|brewpub/i, 'bar'],
  [/steak/i, 'steakhouse'],
  [/seafood|oyster|crab|lobster|fish\s?(house|camp|shack)/i, 'seafood'],
  [/sandwich|sub\b|hoagie/i, 'sandwich'],
  [/\bbowl/i, 'asian'],
  [/waffle|pancake|brunch/i, 'brunch'],
  [/bakery|pastry|patisserie/i, 'bakery'],
  [/\bcurry\b|tikka|masala/i, 'indian'],
  [/\bthai\b/i, 'thai'],
  [/food\s?truck/i, 'food_truck'],
  [/\bdiner\b/i, 'diner'],
];

export function inferTagsFromName(name: string): string[] {
  const tags: string[] = [];
  for (const [pattern, tag] of NAME_KEYWORD_TO_TAG) {
    if (pattern.test(name)) {
      tags.push(tag);
    }
  }
  return tags;
}

export function enrichTags(name: string, rawTags: string[], googleTypes?: string[]): string[] {
  const filtered = rawTags.filter(t => !GENERIC_TAGS.includes(t));
  const combined = new Set<string>();

  for (const t of filtered) {
    const mapped = GOOGLE_TYPE_TO_TAG[t];
    if (mapped) {
      combined.add(mapped);
    } else if (!GENERIC_TAGS.includes(t)) {
      combined.add(t);
    }
  }

  if (googleTypes && googleTypes.length > 0) {
    for (const gType of googleTypes) {
      const mapped = GOOGLE_TYPE_TO_TAG[gType];
      if (mapped && !combined.has(mapped)) {
        combined.add(mapped);
      }
    }
  }

  for (const tag of inferTagsFromName(name)) {
    if (!combined.has(tag)) {
      combined.add(tag);
    }
  }

  const result = Array.from(combined);
  return result.length > 0 ? result : rawTags.filter(t => !['point_of_interest', 'establishment', 'food'].includes(t));
}

const LOW_PRIORITY_TAGS = ['bar', 'store', 'pub', 'food_store', 'catering_service', 'food_delivery', 'event_venue', 'wine_bar'];

export function inferCategory(name: string, tags: string[], googleTypes?: string[], googlePrimaryType?: string): string {
  if (googlePrimaryType) {
    const primaryTag = GOOGLE_TYPE_TO_TAG[googlePrimaryType];
    if (primaryTag && CUISINE_LABELS[primaryTag]) {
      return CUISINE_LABELS[primaryTag];
    }
  }

  if (googleTypes && googleTypes.length > 0) {
    for (const gType of googleTypes) {
      if (GENERIC_TAGS.includes(gType)) continue;
      const mapped = GOOGLE_TYPE_TO_TAG[gType];
      if (mapped && CUISINE_LABELS[mapped]) {
        if (!LOW_PRIORITY_TAGS.includes(mapped)) {
          return CUISINE_LABELS[mapped];
        }
      }
    }
    for (const gType of googleTypes) {
      if (GENERIC_TAGS.includes(gType)) continue;
      const mapped = GOOGLE_TYPE_TO_TAG[gType];
      if (mapped && CUISINE_LABELS[mapped]) {
        return CUISINE_LABELS[mapped];
      }
    }
  }

  const enriched = enrichTags(name, tags, googleTypes);
  const nonGeneric = enriched.filter(t => !GENERIC_TAGS.includes(t));
  if (nonGeneric.length === 0) return '';

  const specific = nonGeneric.filter(t => !LOW_PRIORITY_TAGS.includes(t));
  const best = specific.length > 0 ? specific[0] : nonGeneric[0];
  return CUISINE_LABELS[best] || best.charAt(0).toUpperCase() + best.slice(1).replace(/_/g, ' ');
}
