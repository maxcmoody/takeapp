import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useAuthSync } from "@/hooks/use-auth-sync";
import * as Sentry from "@sentry/react";
import Home from "@/pages/Home";
import MyList from "@/pages/MyList";
import AddRestaurant from "@/pages/AddRestaurant";
import Matchup from "@/pages/Matchup";

import Groups from "@/pages/Groups";
import GroupDetail from "@/pages/GroupDetail";
import Profile from "@/pages/Profile";
import EditProfile from "@/pages/EditProfile";
import Search from "@/pages/Search";
import Leaderboard from "@/pages/Leaderboard";
import RestaurantDetail from "@/pages/RestaurantDetail";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Admin from "@/pages/Admin";
import ReleaseChecklist from "@/pages/ReleaseChecklist";
import InviteRedeem from "@/pages/InviteRedeem";
import Compare from "@/pages/Compare";
import NotFound from "@/pages/not-found";

function Router() {
  useAuthSync();

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/my-list" component={MyList} />
      <Route path="/add" component={AddRestaurant} />
      <Route path="/matchup" component={Matchup} />
      
      <Route path="/groups" component={Groups} />
      <Route path="/groups/:id" component={GroupDetail} />
      <Route path="/restaurant/:id" component={RestaurantDetail} />
      <Route path="/search" component={Search} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/profile" component={Profile} />
      <Route path="/edit-profile" component={EditProfile} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/admin" component={Admin} />
      <Route path="/release" component={ReleaseChecklist} />
      <Route path="/invite/:code" component={InviteRedeem} />
      <Route path="/compare/:userId" component={Compare} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <Sentry.ErrorBoundary fallback={<div className="p-6 text-center text-muted-foreground">Something went wrong. Please refresh.</div>}>
      <QueryClientProvider client={queryClient}>
        <Toaster />
        <Router />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
