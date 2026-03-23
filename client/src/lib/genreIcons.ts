import { Pizza, Beef, Fish, Coffee, Sandwich, Soup, Egg, Wine, Star, Flame, UtensilsCrossed, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type GenreIconConfig = {
  icon: LucideIcon;
  color: string;
};

const GENRE_ICON_MAP: Record<string, GenreIconConfig> = {
  'pizza': { icon: Pizza, color: 'text-orange-500' },
  'burgers': { icon: Beef, color: 'text-amber-600' },
  'mexican': { icon: Flame, color: 'text-red-500' },
  'seafood': { icon: Fish, color: 'text-cyan-500' },
  'bbq': { icon: Flame, color: 'text-orange-600' },
  'italian': { icon: UtensilsCrossed, color: 'text-green-600' },
  'asian': { icon: Soup, color: 'text-rose-500' },
  'chinese': { icon: Soup, color: 'text-red-600' },
  'japanese': { icon: Fish, color: 'text-pink-500' },
  'korean': { icon: Soup, color: 'text-red-400' },
  'thai': { icon: Soup, color: 'text-orange-400' },
  'vietnamese': { icon: Soup, color: 'text-green-500' },
  'breakfast': { icon: Egg, color: 'text-yellow-500' },
  'coffee': { icon: Coffee, color: 'text-amber-700' },
  'southern': { icon: UtensilsCrossed, color: 'text-amber-500' },
  'bar': { icon: Wine, color: 'text-purple-500' },
  'sandwich': { icon: Sandwich, color: 'text-lime-600' },
  'steakhouse': { icon: Beef, color: 'text-red-700' },
  'wings': { icon: Flame, color: 'text-orange-500' },
  'indian': { icon: Soup, color: 'text-yellow-600' },
  'mediterranean': { icon: UtensilsCrossed, color: 'text-blue-500' },
  'greek': { icon: UtensilsCrossed, color: 'text-blue-400' },
  'fine_dining': { icon: Star, color: 'text-yellow-500' },
  'american': { icon: Beef, color: 'text-red-500' },
  'bakery': { icon: Coffee, color: 'text-amber-500' },
  'french': { icon: Wine, color: 'text-indigo-500' },
  'spanish': { icon: Flame, color: 'text-red-600' },
  'caribbean': { icon: Flame, color: 'text-yellow-600' },
  'middle_eastern': { icon: UtensilsCrossed, color: 'text-amber-600' },
};

const DEFAULT_GENRE_ICON: GenreIconConfig = { icon: Trophy, color: 'text-amber-500' };

export function getGenreIcon(tag: string): GenreIconConfig {
  return GENRE_ICON_MAP[tag] || DEFAULT_GENRE_ICON;
}

export { GENRE_ICON_MAP, DEFAULT_GENRE_ICON };
