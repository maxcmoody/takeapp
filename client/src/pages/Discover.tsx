import Layout from "@/components/Layout";
import { MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function Discover() {
  return (
    <Layout>
      <div className="h-full flex flex-col">
        {/* Search Header */}
        <div className="p-4 bg-background border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input 
              placeholder="Search area..." 
              className="pl-10 bg-secondary border-none"
            />
          </div>
        </div>

        {/* Map Placeholder */}
        <div className="flex-1 bg-secondary relative">
             <div className="absolute inset-0 bg-[url('https://api.mapbox.com/styles/v1/mapbox/light-v10/static/-122.4194,37.7749,12,0/800x1200?access_token=pk.mock')] bg-cover bg-center opacity-60 grayscale" />
             <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-background/90 backdrop-blur p-6 rounded-2xl text-center shadow-xl max-w-xs mx-4">
                    <MapPin className="mx-auto mb-2 text-primary" size={32} />
                    <h2 className="font-bold text-lg mb-1">Explore Map</h2>
                    <p className="text-muted-foreground text-sm">
                        Visualize rankings across the city. This is a mockup of the map view.
                    </p>
                </div>
             </div>
        </div>
      </div>
    </Layout>
  );
}
