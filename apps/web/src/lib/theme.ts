import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const themePreferenceKey = "workplan:theme:v1";

export function loadThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const saved = JSON.parse(window.localStorage.getItem(themePreferenceKey) ?? "null") as unknown;
    if (!saved || typeof saved !== "object" || (saved as { version?: unknown }).version !== 1) return "system";
    const preference = (saved as { preference?: unknown }).preference;
    return preference === "light" || preference === "dark" || preference === "system" ? preference : "system";
  } catch {
    return "system";
  }
}

export function getSystemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(getSystemTheme);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const handleChange = (event: MediaQueryListEvent) => setTheme(event.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);
  return theme;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
