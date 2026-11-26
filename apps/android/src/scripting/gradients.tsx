import React from "react"
import { requireNativeComponent, UIManager, View, processColor } from "react-native"
import { resolveColor } from "./theme"

const HAS_NATIVE_GRADIENT = Boolean(UIManager.getViewManagerConfig?.("PixGradientView"))
const NativeGradientView: any = HAS_NATIVE_GRADIENT
  ? requireNativeComponent("PixGradientView")
  : null

function resolvePoint(point: any, fallback: [number, number]): [number, number] {
  if (point && typeof point === "object" && typeof point.x === "number" && typeof point.y === "number") {
    return [point.x, point.y]
  }
  switch (point) {
    case "topLeading":
      return [0, 0]
    case "top":
      return [0.5, 0]
    case "topTrailing":
      return [1, 0]
    case "leading":
      return [0, 0.5]
    case "center":
      return [0.5, 0.5]
    case "trailing":
      return [1, 0.5]
    case "bottomLeading":
      return [0, 1]
    case "bottom":
      return [0.5, 1]
    case "bottomTrailing":
      return [1, 1]
    default:
      return fallback
  }
}

export function GradientFillView({
  fill,
  isDark,
  style,
}: {
  fill: { colors: any[]; startPoint?: any; endPoint?: any }
  isDark: boolean
  style?: any
}) {
  const resolvedColors = (fill.colors || [])
    .map((c) => resolveColor(c, isDark, "transparent") ?? "transparent")
  const [sx, sy] = resolvePoint(fill.startPoint, [0.5, 0])
  const [ex, ey] = resolvePoint(fill.endPoint, [0.5, 1])

  if (NativeGradientView && resolvedColors.length > 0) {
    const processed = resolvedColors.map((c) => processColor(c))
    return (
      <NativeGradientView
        colors={processed}
        startX={sx}
        startY={sy}
        endX={ex}
        endY={ey}
        style={style}
        pointerEvents="none"
      />
    )
  }

  return (
    <View
      pointerEvents="none"
      style={[
        style,
        { backgroundColor: resolvedColors[0] ?? "transparent" },
      ]}
    />
  )
}
