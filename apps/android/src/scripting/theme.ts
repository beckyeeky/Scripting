import React, { createContext, useContext } from "react"
import type { TextStyle } from "react-native"

export type Color = string
export type ScenePhase = "active" | "inactive" | "background"
export type PresentationDetent = "medium" | "large" | { fraction: number } | { height: number }

export interface StyledText {
  content?: string | Array<string | StyledText>
  text?: string
  foregroundColor?: Color
  foregroundStyle?: Color
  font?: any
  fontWeight?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  underlineStyle?: string
  strikethrough?: boolean
  backgroundColor?: Color
  paragraphStyle?: any
  [key: string]: any
}

export interface ThemeValues {
  isDark: boolean
  tint: string
  colors: Record<string, string>
}

const LIGHT_COLORS: Record<string, string> = {
  label: "#111827",
  primary: "#111827",
  secondaryLabel: "#6B7280",
  secondary: "#6B7280",
  tertiaryLabel: "#9CA3AF",
  quaternaryLabel: "#D1D5DB",
  systemBackground: "#F2F2F7",
  secondarySystemBackground: "#FFFFFF",
  tertiarySystemBackground: "#E5E7EB",
  systemGroupedBackground: "#F2F2F7",
  secondarySystemGroupedBackground: "#FFFFFF",
  tertiarySystemGroupedBackground: "#F9FAFB",
  systemFill: "rgba(120,120,128,0.20)",
  secondarySystemFill: "rgba(120,120,128,0.16)",
  tertiarySystemFill: "rgba(120,120,128,0.12)",
  quaternarySystemFill: "rgba(120,120,128,0.08)",
  separator: "rgba(60,60,67,0.18)",
  opaqueSeparator: "#C6C6C8",
  systemBlue: "#007AFF",
  blue: "#007AFF",
  systemRed: "#FF3B30",
  red: "#FF3B30",
  systemGreen: "#34C759",
  green: "#34C759",
  systemOrange: "#FF9500",
  orange: "#FF9500",
  systemYellow: "#FFCC00",
  yellow: "#FFCC00",
  systemPink: "#FF2D55",
  pink: "#FF2D55",
  systemPurple: "#AF52DE",
  purple: "#AF52DE",
  systemIndigo: "#5856D6",
  indigo: "#5856D6",
  systemTeal: "#30B0C7",
  teal: "#30B0C7",
  systemCyan: "#32ADE6",
  cyan: "#32ADE6",
  systemMint: "#00C7BE",
  systemBrown: "#A2845E",
  systemGray: "#8E8E93",
  gray: "#8E8E93",
  systemGray2: "#AEAEB2",
  systemGray3: "#C7C7CC",
  systemGray4: "#D1D1D6",
  systemGray5: "#E5E5EA",
  systemGray6: "#F2F2F7",
  white: "#FFFFFF",
  black: "#000000",
  clear: "transparent",
  ultraThinMaterial: "rgba(255,255,255,0.72)",
  thinMaterial: "rgba(255,255,255,0.82)",
  regularMaterial: "rgba(255,255,255,0.90)",
  thickMaterial: "rgba(255,255,255,0.95)",
}

const DARK_COLORS: Record<string, string> = {
  label: "#F9FAFB",
  primary: "#F9FAFB",
  secondaryLabel: "#9CA3AF",
  secondary: "#9CA3AF",
  tertiaryLabel: "#6B7280",
  quaternaryLabel: "#4B5563",
  systemBackground: "#000000",
  secondarySystemBackground: "#1C1C1E",
  tertiarySystemBackground: "#2C2C2E",
  systemGroupedBackground: "#000000",
  secondarySystemGroupedBackground: "#1C1C1E",
  tertiarySystemGroupedBackground: "#2C2C2E",
  systemFill: "rgba(120,120,128,0.36)",
  secondarySystemFill: "rgba(120,120,128,0.32)",
  tertiarySystemFill: "rgba(118,118,128,0.24)",
  quaternarySystemFill: "rgba(118,118,128,0.18)",
  separator: "rgba(84,84,88,0.65)",
  opaqueSeparator: "#38383A",
  systemBlue: "#0A84FF",
  blue: "#0A84FF",
  systemRed: "#FF453A",
  red: "#FF453A",
  systemGreen: "#30D158",
  green: "#30D158",
  systemOrange: "#FF9F0A",
  orange: "#FF9F0A",
  systemYellow: "#FFD60A",
  yellow: "#FFD60A",
  systemPink: "#FF375F",
  pink: "#FF375F",
  systemPurple: "#BF5AF2",
  purple: "#BF5AF2",
  systemIndigo: "#5E5CE6",
  indigo: "#5E5CE6",
  systemTeal: "#40CBE0",
  teal: "#40CBE0",
  systemCyan: "#64D2FF",
  cyan: "#64D2FF",
  systemMint: "#63E6E2",
  systemBrown: "#AC8E68",
  systemGray: "#8E8E93",
  gray: "#8E8E93",
  systemGray2: "#636366",
  systemGray3: "#48484A",
  systemGray4: "#3A3A3C",
  systemGray5: "#2C2C2E",
  systemGray6: "#1C1C1E",
  white: "#FFFFFF",
  black: "#000000",
  clear: "transparent",
  ultraThinMaterial: "rgba(28,28,30,0.78)",
  thinMaterial: "rgba(28,28,30,0.86)",
  regularMaterial: "rgba(28,28,30,0.92)",
  thickMaterial: "rgba(28,28,30,0.96)",
}

export const ThemeContext = createContext<ThemeValues>({
  isDark: false,
  tint: "#007AFF",
  colors: LIGHT_COLORS,
})

export function useTheme(): ThemeValues {
  return useContext(ThemeContext)
}

export function resolveColor(value: any, isDark: boolean, fallback?: string): string | undefined {
  if (value == null) return fallback
  if (typeof value === "string") {
    const palette = isDark ? DARK_COLORS : LIGHT_COLORS
    if (palette[value]) return palette[value]
    if (value === "accentColor") return palette.systemBlue
    return value
  }
  if (typeof value === "object") {
    if (typeof value.color === "string") return resolveColor(value.color, isDark, fallback)
    if (typeof value.light === "string" || typeof value.dark === "string") {
      return resolveColor(isDark ? (value.dark ?? value.light) : (value.light ?? value.dark), isDark, fallback)
    }
    if (Array.isArray(value.colors) && value.colors.length > 0) {
      return resolveColor(value.colors[0], isDark, fallback)
    }
  }
  return fallback
}

const FONT_SIZE_PRESETS: Record<string, { fontSize: number; fontWeight?: TextStyle["fontWeight"] }> = {
  largeTitle: { fontSize: 32, fontWeight: "700" },
  title: { fontSize: 26, fontWeight: "700" },
  title2: { fontSize: 21, fontWeight: "700" },
  title3: { fontSize: 19, fontWeight: "600" },
  headline: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 16, fontWeight: "400" },
  callout: { fontSize: 15, fontWeight: "400" },
  subheadline: { fontSize: 14, fontWeight: "400" },
  footnote: { fontSize: 13, fontWeight: "400" },
  caption: { fontSize: 12, fontWeight: "400" },
  caption2: { fontSize: 11, fontWeight: "400" },
}

const WEIGHT_MAP: Record<string, TextStyle["fontWeight"]> = {
  ultraLight: "100",
  thin: "200",
  light: "300",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  heavy: "800",
  black: "900",
}

export function resolveFontStyle(font: any, fontWeight?: string): TextStyle {
  const style: TextStyle = {}
  if (typeof font === "number") {
    style.fontSize = font
  } else if (typeof font === "string") {
    const preset = FONT_SIZE_PRESETS[font]
    if (preset) {
      style.fontSize = preset.fontSize
      if (preset.fontWeight) style.fontWeight = preset.fontWeight
    }
  } else if (font && typeof font === "object") {
    if (typeof font.size === "number") style.fontSize = font.size
    else if (typeof font.style === "string" && FONT_SIZE_PRESETS[font.style]) {
      style.fontSize = FONT_SIZE_PRESETS[font.style].fontSize
    }
    if (font.design === "monospaced") style.fontFamily = "monospace"
    else if (font.design === "serif") style.fontFamily = "serif"
    if (font.weight && WEIGHT_MAP[font.weight]) style.fontWeight = WEIGHT_MAP[font.weight]
  }
  if (fontWeight && WEIGHT_MAP[fontWeight]) {
    style.fontWeight = WEIGHT_MAP[fontWeight]
  }
  return style
}
