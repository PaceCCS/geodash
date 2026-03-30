import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

function applyThemeClass(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const stored = window.localStorage.getItem("theme");
    if (!stored) {
      return "light";
    }

    const parsed = JSON.parse(stored) as {
      state?: {
        theme?: Theme;
      };
    };

    return parsed.state?.theme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const initialTheme = getStoredTheme();
applyThemeClass(initialTheme);

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: initialTheme,
      setTheme: (theme) => {
        applyThemeClass(theme);
        set({ theme });
      },
      toggle: () =>
        set((s) => {
          const next = s.theme === "light" ? "dark" : "light";
          applyThemeClass(next);
          return { theme: next };
        }),
    }),
    {
      name: "theme",
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        applyThemeClass(state?.theme === "dark" ? "dark" : "light");
      },
    },
  ),
);
