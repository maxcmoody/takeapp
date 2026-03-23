const KNOWN_CHAINS = new Set([
  "starbucks", "mcdonalds", "subway", "chipotle", "taco bell", "wendys",
  "burger king", "dunkin", "panera", "dominos", "pizza hut", "papa johns",
  "kfc", "chick-fil-a", "chickfila", "popeyes", "sonic", "arbys",
  "jack in the box", "whataburger", "five guys", "in-n-out", "shake shack",
  "panda express", "olive garden", "applebees", "chilis", "ihop",
  "denny's", "dennys", "waffle house", "cracker barrel", "red lobster",
  "outback steakhouse", "longhorn steakhouse", "texas roadhouse",
  "buffalo wild wings", "wingstop", "zaxbys", "raising canes",
  "jersey mikes", "jimmy johns", "firehouse subs", "jason's deli",
  "moes southwest grill", "qdoba", "el pollo loco", "del taco",
  "little caesars", "marcos pizza", "hungry howies",
  "red robin", "tgi fridays", "ruby tuesday", "golden corral",
  "bob evans", "steak n shake", "culvers", "cookout",
  "checkers", "rallys", "hardees", "carls jr",
  "noodles and company", "pei wei", "cici's pizza", "cicis",
  "bojangles", "captain ds", "long john silvers",
  "dairy queen", "baskin robbins", "cold stone",
  "tropical smoothie", "smoothie king", "jamba juice",
  "chipotle mexican grill", "taco bueno", "church's chicken",
  "el pollo loco", "wienerschnitzel", "white castle",
  "tim hortons", "krispy kreme",
  "sbarro", "auntie annes", "cinnabon",
  "papa murphys", "round table pizza", "chuck e cheese",
  "boston market", "waba grill", "el pollo loco",
  "pollo tropical", "captain d's", "church's texas chicken",
  "carrabba's", "carrabbas", "hardee's",
]);

const STRIP_SUFFIXES = /\b(inc|llc|ltd|corp|restaurant|restaurants|grill|grille|cafe|diner|eatery|kitchen|bar|pub|tavern|bistro|pizzeria|steakhouse|the|and|&)\b/g;
const STRIP_PUNCTUATION = /[^a-z0-9\s]/g;
const COLLAPSE_SPACES = /\s+/g;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(STRIP_PUNCTUATION, "")
    .replace(STRIP_SUFFIXES, "")
    .replace(COLLAPSE_SPACES, " ")
    .trim();
}

export function isLikelyChain(name: string, nameCountMap?: Map<string, number>): boolean {
  const normalized = normalizeName(name);
  if (KNOWN_CHAINS.has(normalized)) return true;
  let found = false;
  KNOWN_CHAINS.forEach((chain) => {
    if (normalized.startsWith(chain) || normalized.endsWith(chain)) found = true;
  });
  if (found) return true;
  if (nameCountMap) {
    const count = nameCountMap.get(normalized) || 0;
    if (count >= 3) return true;
  }
  return false;
}

export type BiasMode = "auto" | "off" | "strong";

interface ScoredPlace {
  place_id: string;
  name: string;
  vicinity?: string;
  rating: number;
  user_ratings_total: number;
  price_level?: number;
  types?: string[];
  photo_reference?: string | null;
  _discoveryScore?: number;
  _likelyChain?: boolean;
}

export function applyChainBias(
  results: ScoredPlace[],
  options: {
    rankedCount?: number;
    biasMode?: BiasMode;
    chainPenaltyStrength?: number;
    nameCountMap?: Map<string, number>;
  } = {}
): ScoredPlace[] {
  const {
    rankedCount = 0,
    biasMode = "auto",
    chainPenaltyStrength: overrideStrength,
    nameCountMap,
  } = options;

  if (biasMode === "off") return results;

  const baseStrength = biasMode === "strong" ? 0.7 : 0.5;
  const strength = overrideStrength ?? baseStrength;
  const userMaturity = Math.min(1, rankedCount / 20);
  const chainPenaltyMultiplier = 1 - userMaturity * strength;

  const scored = results.map((place) => {
    const baseScore = place.rating * Math.log(place.user_ratings_total || 1);
    const likelyChain = isLikelyChain(place.name, nameCountMap);
    const score = likelyChain ? baseScore * chainPenaltyMultiplier : baseScore;
    return { ...place, _discoveryScore: score, _likelyChain: likelyChain };
  });

  scored.sort((a, b) => (b._discoveryScore ?? 0) - (a._discoveryScore ?? 0));

  const top15 = scored.slice(0, 15);
  const hasChainInTop15 = top15.some((p) => p._likelyChain);
  if (!hasChainInTop15 && scored.some((p) => p._likelyChain)) {
    const firstChainIdx = scored.findIndex((p) => p._likelyChain);
    if (firstChainIdx >= 15) {
      const chain = scored.splice(firstChainIdx, 1)[0];
      scored.splice(14, 0, chain);
    }
  }

  const seen = new Map<string, number>();
  const diversified: ScoredPlace[] = [];
  const deferred: ScoredPlace[] = [];
  for (const place of scored) {
    const norm = normalizeName(place.name);
    const isChain = isLikelyChain(place.name, nameCountMap);
    const count = seen.get(norm) || 0;
    const maxPerName = isChain ? 1 : 2;
    if (count >= maxPerName) {
      deferred.push(place);
    } else {
      seen.set(norm, count + 1);
      diversified.push(place);
    }
  }
  diversified.push(...deferred.filter(p => !isLikelyChain(p.name, nameCountMap)));

  return diversified.map(({ _discoveryScore, _likelyChain, ...rest }) => rest);
}

export function buildNameCountMap(results: { name: string }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    const norm = normalizeName(r.name);
    map.set(norm, (map.get(norm) || 0) + 1);
  }
  return map;
}
