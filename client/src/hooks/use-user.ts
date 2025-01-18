import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AvatarConfig {
  userId: number;
  personalityTraits: string[];
  responseStyle: string;
  writingStyle: string;
  contextWindow: number;
}

interface User {
  id: number;
  username: string;
  avatar?: string;
  bio?: string;
  avatarConfig?: AvatarConfig;
  useAiResponse?: boolean;
}

interface UserState {
  user: User | null;
  token: string | null;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  register: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => void;
  refresh: (token: string) => Promise<void>;
  updateProfile: (formData: FormData, token: string) => Promise<void>;
}

export const useUser = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: async (credentials) => {
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
          credentials: "include"
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = await response.json();
        set({ user: data.user, token: data.token });
      },
      register: async (credentials) => {
        const response = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
          credentials: "include"
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = await response.json();
        set({ user: data.user, token: data.token });
      },
      logout: () => set({ user: null, token: null }),
      refresh: async (token) => {
        const response = await fetch("/api/user", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = await response.json();
        set({ user: data });
      },
      updateProfile: async (formData, token) => {
        const response = await fetch("/api/users/profile", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const updatedUser = await response.json();
        set({ user: updatedUser });
      }
    }),
    { name: "user-storage" }
  )
);