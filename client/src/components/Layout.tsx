import { Link, useLocation } from "wouter";
import { Home, Search, User, List, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems: { icon: typeof Home; label: React.ReactNode; path: string }[] = [
    { icon: Home, label: "Home", path: "/" },
    { icon: List, label: <span className="font-heading tracking-tighter uppercase"><span className="font-light">MY</span><span className="font-black">TAKE</span></span>, path: "/my-list" },
    { icon: Search, label: "Search", path: "/search" },
    { icon: Users, label: "Groups", path: "/groups" },
    { icon: User, label: "Profile", path: "/profile" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col max-w-md mx-auto shadow-2xl overflow-hidden relative border-x border-border/40">
      <main className="flex-1 overflow-y-auto pb-24 scrollbar-hide">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border max-w-md mx-auto">
        <div className="flex justify-around items-center h-20 px-2 pb-2">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
            return (
              <Link key={item.path} href={item.path} className={cn(
                  "flex flex-col items-center justify-center w-16 h-14 rounded-2xl transition-all duration-200 gap-0.5",
                  isActive 
                    ? "text-primary bg-primary/10 scale-105" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}>
                  <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[10px] font-medium tracking-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
