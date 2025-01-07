import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: number;
  username: string;
  avatar?: string;
}

interface UserState {
  user: User | null;
  token: string | null;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  register: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => void;
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
      logout: () => set({ user: null, token: null })
    }),
    { name: "user-storage" }
  )
);