import type { AppSettings } from "../../../../../Pix-Scripting/src/store/settings"

export interface AppPalette {
  bg: string
  surface: string
  surfaceElevated: string
  glassBg: string
  glassBorder: string
  text: string
  textSecondary: string
  textTertiary: string
  separator: string
  fill: string
  fillStrong: string
  danger: string
  pink: string
  green: string
  orange: string
  purple: string
  yellow: string
  backdrop: string
}

export interface AppTheme {
  isDark: boolean
  accent: string
  accentSoft: string
  settings: AppSettings
  colors: AppPalette
}

export const LIGHT_PALETTE: AppPalette = {
  bg: "#F2F2F7",
  surface: "#FFFFFF",
  surfaceElevated: "#F9FAFB",
  glassBg: "rgba(255, 255, 255, 0.92)",
  glassBorder: "rgba(0, 0, 0, 0.08)",
  text: "#111827",
  textSecondary: "#6B7280",
  textTertiary: "#9CA3AF",
  separator: "rgba(60, 60, 67, 0.14)",
  fill: "rgba(120, 120, 128, 0.12)",
  fillStrong: "rgba(120, 120, 128, 0.22)",
  danger: "#FF3B30",
  pink: "#FF2D55",
  green: "#34C759",
  orange: "#FF9500",
  purple: "#AF52DE",
  yellow: "#FFCC00",
  backdrop: "rgba(0, 0, 0, 0.44)",
}

export const DARK_PALETTE: AppPalette = {
  bg: "#000000",
  surface: "#1C1C1E",
  surfaceElevated: "#2C2C2E",
  glassBg: "rgba(28, 28, 30, 0.92)",
  glassBorder: "rgba(255, 255, 255, 0.13)",
  text: "#F9FAFB",
  textSecondary: "#9CA3AF",
  textTertiary: "#6B7280",
  separator: "rgba(84, 84, 88, 0.55)",
  fill: "rgba(120, 120, 128, 0.24)",
  fillStrong: "rgba(120, 120, 128, 0.38)",
  danger: "#FF453A",
  pink: "#FF375F",
  green: "#30D158",
  orange: "#FF9F0A",
  purple: "#BF5AF2",
  yellow: "#FFD60A",
  backdrop: "rgba(0, 0, 0, 0.62)",
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace(/^#/, "")
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16)
    const g = parseInt(clean[1] + clean[1], 16)
    const b = parseInt(clean[2] + clean[2], 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
  } else if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
  }
  return `rgba(0, 122, 255, ${alpha})`
}

export function buildAppTheme(
  settings: AppSettings,
  systemScheme: "light" | "dark",
): AppTheme {
  const isDark =
    settings.colorScheme === "dark"
      ? true
      : settings.colorScheme === "light"
        ? false
        : systemScheme === "dark"

  const accent =
    settings.glassCustomTintEnabled && settings.glassTintColor && settings.glassTintColor.trim()
      ? settings.glassTintColor.trim()
      : isDark
        ? "#0A84FF"
        : "#007AFF"

  return {
    isDark,
    accent,
    accentSoft: hexToRgba(accent, isDark ? 0.22 : 0.13),
    settings,
    colors: isDark ? DARK_PALETTE : LIGHT_PALETTE,
  }
}
