import { useColorScheme } from "react-native";

export interface Palette {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
}

const light: Palette = {
  background: "#f4f6f9",
  surface: "#ffffff",
  surfaceMuted: "#e9edf3",
  text: "#111827",
  muted: "#5b6472",
  border: "#d9dee7",
  accent: "#0f766e",
  onAccent: "#ffffff",
  accentSoft: "#dcf3ef",
  danger: "#b91c1c",
  dangerSoft: "#fde8e8",
  warning: "#a16207",
};

const dark: Palette = {
  background: "#0d1117",
  surface: "#161b22",
  surfaceMuted: "#1f2630",
  text: "#eef1f5",
  muted: "#9aa4b2",
  border: "#2d3542",
  accent: "#2dd4bf",
  onAccent: "#042f2a",
  accentSoft: "#10302c",
  danger: "#f87171",
  dangerSoft: "#3b1717",
  warning: "#facc15",
};

/** The palette for the system's light or dark appearance. */
export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };
/** Column width on wide screens (web, tablets). */
export const MAX_WIDTH = 760;
export const MONO = "monospace";
