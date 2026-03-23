import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Users, Plus, ChevronRight, Loader2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useClerk } from "@clerk/clerk-react";

interface GroupListItem {
  id: string;
  name: string;
  joinCode: string;
  createdByUserId: string;
  createdAt: string;
  memberCount: number;
  role: string;
}

export default function Groups() {
  const [_, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { openSignIn } = useClerk();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const { data, isLoading } = useQuery<{ groups: GroupListItem[] }>({
    queryKey: ["/api/groups"],
    enabled: isAuthenticated,
  });

  const groups = data?.groups ?? [];

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/groups", { name });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setCreateOpen(false);
      setNewGroupName("");
      toast({ title: "Group created!" });
      if (data?.id) {
        setLocation(`/groups/${data.id}`);
      }
    },
    onError: () => {
      toast({ title: "Failed to create group", variant: "destructive" });
    },
  });

  const joinMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/groups/join", { code });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setJoinOpen(false);
      setJoinCode("");
      if (data.alreadyMember) {
        toast({ title: "You're already in this group" });
      } else {
        toast({ title: `Joined "${data.group.name}"!` });
      }
      if (data.group?.id) {
        setLocation(`/groups/${data.group.id}`);
      }
    },
    onError: () => {
      toast({ title: "Invalid join code", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newGroupName.trim()) return;
    createMutation.mutate(newGroupName.trim());
  };

  const handleJoin = () => {
    if (!joinCode.trim()) return;
    joinMutation.mutate(joinCode.trim());
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="p-6 pt-12 pb-24 text-center">
          <Users size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <h2 className="text-xl font-heading font-bold mb-2">Sign in to use Groups</h2>
          <p className="text-sm text-muted-foreground mb-4">Create or join groups to combine rankings with friends.</p>
          <Button onClick={() => openSignIn()} data-testid="button-login">
            Sign In
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 pt-12 pb-24">
        <header className="flex justify-between items-end mb-6">
          <div>
            <h1 className="text-3xl font-heading font-extrabold text-foreground tracking-tight" data-testid="text-groups-title">
              Groups
            </h1>
            <p className="text-muted-foreground text-sm font-medium mt-1">
              Combine rankings with friends
            </p>
          </div>

          <div className="flex gap-2">
            <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="outline" className="rounded-full h-10 w-10" data-testid="button-join-group">
                  <UserPlus size={18} />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="font-heading text-xl">Join a Group</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Join Code</Label>
                    <Input
                      placeholder="e.g. ABC123"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      maxLength={8}
                      className="text-center text-lg font-mono tracking-widest"
                      data-testid="input-join-code"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleJoin}
                    disabled={joinMutation.isPending || !joinCode.trim()}
                    data-testid="button-submit-join"
                  >
                    {joinMutation.isPending ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                    Join Group
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="icon" className="rounded-full h-10 w-10 shadow-lg bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-create-group">
                  <Plus size={20} />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="font-heading text-xl">Create New Group</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Group Name</Label>
                    <Input
                      placeholder="e.g. Sunday Brunch Squad"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      data-testid="input-group-name"
                    />
                  </div>
                  <Button
                    className="w-full mt-4"
                    onClick={handleCreate}
                    disabled={createMutation.isPending || !newGroupName.trim()}
                    data-testid="button-submit-create"
                  >
                    {createMutation.isPending ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                    Create Group
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-primary" size={24} />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl">
            <Users size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <h3 className="font-heading font-bold text-lg mb-1">No groups yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create a group or join one with a code</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(group => (
              <div
                key={group.id}
                onClick={() => setLocation(`/groups/${group.id}`)}
                className="bg-card p-4 rounded-2xl border border-border/50 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.99]"
                data-testid={`card-group-${group.id}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {group.role === 'owner' ? 'Owner' : 'Member'}
                  </span>
                  <div className="flex items-center text-primary">
                    <span className="text-xs font-bold mr-1">View</span>
                    <ChevronRight size={14} />
                  </div>
                </div>

                <h3 className="text-xl font-bold font-heading mb-2" data-testid={`text-group-name-${group.id}`}>{group.name}</h3>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Users size={14} />
                    <span className="text-sm font-medium">{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</span>
                  </div>
                  <div className="text-xs font-mono bg-secondary px-2 py-1 rounded text-muted-foreground">
                    {group.joinCode}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
