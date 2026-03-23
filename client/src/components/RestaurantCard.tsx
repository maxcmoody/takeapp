import { useState } from "react";
import { motion } from "framer-motion";
import { MapPin, ShoppingBag, TrendingUp, TrendingDown, UtensilsCrossed } from "lucide-react";
import { Restaurant } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { getDisplayCategoryLabel } from "@shared/displayCategory";

interface RestaurantCardProps {
  restaurant: Restaurant;
  rank?: number;
  compact?: boolean;
  movement?: { delta: number; isNew: boolean } | null;
}

export default function RestaurantCard({ restaurant, rank, compact = false, movement }: RestaurantCardProps) {
  const { toast } = useToast();
  const [_, setLocation] = useLocation();
  const [imgFailed, setImgFailed] = useState(false);
  const [retried, setRetried] = useState(false);
  const hasTakeout = restaurant.tags.some(tag => 
    ['takeout', 'delivery', 'fast', 'casual'].includes(tag.toLowerCase())
  );
  const displayCategory = getDisplayCategoryLabel(restaurant.googleTypes, restaurant.googlePrimaryType, restaurant.category);

  const getImageSrc = () => {
    if (!restaurant.image) return '';
    if (retried || imgFailed) return '';
    // Only append placeId if not already present in the stored URL
    if (restaurant.googlePlaceId && !restaurant.image.includes('placeId=')) {
      const sep = restaurant.image.includes('?') ? '&' : '?';
      return `${restaurant.image}${sep}placeId=${encodeURIComponent(restaurant.googlePlaceId)}`;
    }
    return restaurant.image;
  };

  const handleImgError = () => {
    if (!retried && restaurant.googlePlaceId && restaurant.image) {
      setRetried(true);
      setImgFailed(false);
      const retryUrl = getImageSrc();
      const img = new Image();
      img.onload = () => {
        setImgFailed(false);
        const el = document.querySelector(`[data-img-id="${restaurant.id}"]`) as HTMLImageElement;
        if (el) el.src = retryUrl;
      };
      img.onerror = () => setImgFailed(true);
      img.src = retryUrl;
    } else {
      setImgFailed(true);
    }
  };

  const handleOrder = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast({
      title: "Order Placed!",
      description: `Your TAKEout from ${restaurant.name} is on the way.`,
    });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative bg-card rounded-2xl overflow-hidden border border-border/50 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
      onClick={() => setLocation(`/restaurant/${restaurant.id}`)}
      data-testid={`card-restaurant-${restaurant.id}`}
    >
      <div className="flex h-full">
        {rank && (
          <div className="absolute top-0 left-0 bg-primary text-primary-foreground font-heading font-bold text-lg px-3 py-2 rounded-br-xl z-10 shadow-lg">
            #{rank}
          </div>
        )}
        {movement?.isNew && (
          <div className="absolute top-0 right-0 z-10 bg-blue-500 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg" data-testid={`badge-new-${restaurant.id}`}>
            NEW
          </div>
        )}
        {movement && !movement.isNew && movement.delta > 0 && (
          <div className="absolute top-0 right-0 z-10 bg-emerald-500/90 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg flex items-center gap-0.5" data-testid={`badge-up-${restaurant.id}`}>
            <TrendingUp size={10} />
            {movement.delta}
          </div>
        )}
        {movement && !movement.isNew && movement.delta < 0 && (
          <div className="absolute top-0 right-0 z-10 bg-red-500/90 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg flex items-center gap-0.5" data-testid={`badge-down-${restaurant.id}`}>
            <TrendingDown size={10} />
            {Math.abs(movement.delta)}
          </div>
        )}

        {/* Image */}
        <div className={`relative ${compact ? 'w-24' : 'w-1/3'} bg-muted`}>
          {restaurant.image && !imgFailed ? (
            <img
              data-img-id={restaurant.id}
              src={getImageSrc()}
              alt={restaurant.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              onError={handleImgError}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <UtensilsCrossed size={24} className="text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors" />
        </div>

        {/* Content */}
        <div className="flex-1 p-4 flex flex-col">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h3 className="font-heading font-bold text-lg leading-tight text-foreground mb-1">
                {restaurant.name}
              </h3>
              <div className="flex items-center text-muted-foreground text-xs font-medium mb-2 gap-2">
                <span className="flex items-center gap-1">
                  <MapPin size={12} className="text-primary" />
                  {restaurant.location}
                </span>
                {displayCategory && displayCategory !== 'Restaurant' && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span>{displayCategory}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center justify-between mt-auto pt-2">
            <div className="flex flex-wrap gap-1">
              {restaurant.tags.slice(0, 2).map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[10px] uppercase tracking-wider font-bold">
                  {tag}
                </span>
              ))}
            </div>
            
            {hasTakeout && !compact && (
              <Button 
                size="sm" 
                variant="secondary"
                className="h-8 px-3 text-[10px] bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground border-none rounded-lg"
                onClick={handleOrder}
              >
                <ShoppingBag size={12} className="mr-1.5" />
                Order <span className="font-heading font-black uppercase tracking-tighter">TAKE</span>out
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
