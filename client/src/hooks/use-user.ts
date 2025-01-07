import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from "@db/schema";

type LoginData = {
  username: string;
  password: string;
};

export function useUser() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/user"],
    retry: false,
    staleTime: Infinity, // Prevent automatic refetching
    refetchOnMount: false, // Don't refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus
    gcTime: Infinity, // Keep the data cached indefinitely
    // Return null for 401 responses instead of throwing
    queryFn: async () => {
      const response = await fetch("/api/user", {
        credentials: "include"
      });

      if (!response.ok) {
        if (response.status === 401) {
          return null;
        }
        throw new Error(await response.text());
      }

      return response.json();
    }
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginData) => {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = await response.json();
      // Update the user data in the cache immediately
      queryClient.setQueryData(["/api/user"], result.user);
      return result;
    }
  });

  const registerMutation = useMutation({
    mutationFn: async (data: LoginData) => {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = await response.json();
      // Update the user data in the cache immediately
      queryClient.setQueryData(["/api/user"], result.user);
      return result;
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/logout", {
        method: "POST",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      // Clear the user data from the cache immediately
      queryClient.setQueryData(["/api/user"], null);
    }
  });

  return {
    user,
    isLoading,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync
  };
}