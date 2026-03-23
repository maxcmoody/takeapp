import { useUser, useClerk } from "@clerk/clerk-react";

export function useAuth() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  return {
    user: user ? {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress || null,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      profileImageUrl: user.imageUrl || null,
    } : null,
    isLoading: !isLoaded,
    isAuthenticated: !!user,
    logout: () => signOut({ redirectUrl: "/" }),
    isLoggingOut: false,
  };
}
