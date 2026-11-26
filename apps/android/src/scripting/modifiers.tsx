import React from "react"
import { Pressable, Text as RNText, View, type ViewStyle } from "react-native"
import { resolveColor, useTheme } from "./theme"
import { GradientFillView } from "./gradients"

export type CommonViewProps = Record<string, any>
export type VirtualNode = React.ReactNode

// Prevent React Native crash: "Text strings must be rendered within a <Text> component"
export function sanitizeViewChildren(children: React.ReactNode): React.ReactNode {
  if (children == null || typeof children === "boolean") return null
  if (typeof children === "string" || typeof children === "number") {
    const s = String(children)
    if (!s.trim()) return null
    return <RNText>{s}</RNText>
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => {
      if (child == null || typeof child === "boolean") return null
      if (typeof child === "string" || typeof child === "number") {
        const s = String(child)
        if (!s.trim()) return null
        return <RNText key={`txt-${idx}`}>{s}</RNText>
      }
      if (Array.isArray(child)) {
        return <React.Fragment key={`frag-${idx}`}>{sanitizeViewChildren(child)}</React.Fragment>
      }
      return child
    })
  }
  return children
}

export function resolvePaddingStyle(padding: any): ViewStyle {
  if (padding == null) return {}
  if (typeof padding === "number") return { padding }
  if (padding === true) return { padding: 12 }
  if (typeof padding === "object") {
    const s: ViewStyle = {}
    if (typeof padding.horizontal === "number") s.paddingHorizontal = padding.horizontal
    if (typeof padding.vertical === "number") s.paddingVertical = padding.vertical
    if (typeof padding.top === "number") s.paddingTop = padding.top
    if (typeof padding.bottom === "number") s.paddingBottom = padding.bottom
    if (typeof padding.leading === "number") s.paddingLeft = padding.leading
    if (typeof padding.trailing === "number") s.paddingRight = padding.trailing
    if (typeof padding.left === "number") s.paddingLeft = padding.left
    if (typeof padding.right === "number") s.paddingRight = padding.right
    return s
  }
  return {}
}

export function resolveFrameStyle(frame: any, layoutContext?: "hstack" | "vstack" | "zstack"): ViewStyle {
  if (!frame || typeof frame !== "object") return {}
  const s: ViewStyle = {}
  if (typeof frame.width === "number") s.width = frame.width
  if (typeof frame.height === "number") s.height = frame.height
  if (typeof frame.minWidth === "number") s.minWidth = frame.minWidth
  if (typeof frame.minHeight === "number") s.minHeight = frame.minHeight
  if (typeof frame.maxWidth === "number") s.maxWidth = frame.maxWidth
  else if (frame.maxWidth === "infinity") {
    if (layoutContext === "hstack") {
      s.flex = 1
    } else {
      s.width = "100%"
    }
  }
  if (typeof frame.maxHeight === "number") s.maxHeight = frame.maxHeight
  else if (frame.maxHeight === "infinity") {
    if (layoutContext === "vstack") {
      s.flex = 1
    } else {
      s.height = "100%"
    }
  }
  if (frame.alignment === "leading") s.alignItems = "flex-start"
  else if (frame.alignment === "trailing") s.alignItems = "flex-end"
  else if (frame.alignment === "center") s.alignItems = "center"
  return s
}

export function resolveRadiusFromClipShape(clipShape: any, cornerRadius?: number): number | undefined {
  if (typeof cornerRadius === "number") return cornerRadius
  if (!clipShape) return undefined
  if (clipShape === "capsule") return 9999
  if (clipShape === "circle") return 9999
  if (typeof clipShape === "object") {
    if (clipShape.type === "capsule" || clipShape.type === "circle") return 9999
    if (typeof clipShape.cornerRadius === "number") return clipShape.cornerRadius
    return 12
  }
  return undefined
}

export function resolveGlassBackground(glassEffect: any, isDark: boolean): ViewStyle | null {
  if (!glassEffect) return null
  const radius = resolveRadiusFromClipShape(
    glassEffect.shape ?? glassEffect,
    glassEffect.cornerRadius ?? 14,
  )
  const rawTint = glassEffect?.glass?.tintColor ?? glassEffect?.tint
  const tint = rawTint
    ? resolveColor(rawTint, isDark)
    : undefined
  return {
    backgroundColor: tint || (isDark ? "rgba(38, 38, 42, 0.82)" : "rgba(255, 255, 255, 0.84)"),
    borderWidth: 0.75,
    borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.08)",
    ...(radius != null ? { borderRadius: radius, overflow: "hidden" as const } : {}),
  }
}

export function buildViewStyle(props: Record<string, any>, isDark: boolean, layoutContext?: "hstack" | "vstack" | "zstack"): ViewStyle {
  const s: ViewStyle = {}
  if (props.frame) Object.assign(s, resolveFrameStyle(props.frame, layoutContext))
  if (props.padding != null) Object.assign(s, resolvePaddingStyle(props.padding))
  if (typeof props.opacity === "number") s.opacity = props.opacity
  if (typeof props.zIndex === "number") s.zIndex = props.zIndex
  if (props.clipped) s.overflow = "hidden"

  const radius = resolveRadiusFromClipShape(props.clipShape, props.cornerRadius)
  if (radius != null) {
    s.borderRadius = radius
    s.overflow = "hidden"
  }

  if (props.glassEffect) {
    Object.assign(s, resolveGlassBackground(props.glassEffect, isDark))
  }

  if (props.background != null && typeof props.background === "string") {
    s.backgroundColor = resolveColor(props.background, isDark)
  } else if (props.background && typeof props.background === "object" && !React.isValidElement(props.background) && !Array.isArray(props.background.colors)) {
    const col = resolveColor(props.background, isDark)
    if (col) s.backgroundColor = col
  }

  if (props.aspectRatio) {
    if (typeof props.aspectRatio === "number") s.aspectRatio = props.aspectRatio
    else if (typeof props.aspectRatio === "object" && typeof props.aspectRatio.value === "number") {
      s.aspectRatio = props.aspectRatio.value
    }
  }

  if (props.shadow && typeof props.shadow === "object") {
    s.shadowColor = resolveColor(props.shadow.color, isDark, "#000") || "#000"
    s.shadowRadius = props.shadow.radius ?? 6
    s.shadowOpacity = 0.22
    s.shadowOffset = { width: props.shadow.x ?? 0, height: props.shadow.y ?? 2 }
    s.elevation = Math.max(1, Math.min(12, Math.round((props.shadow.radius ?? 6) / 2)))
  }

  const transforms: any[] = []
  if (props.offset && typeof props.offset === "object") {
    if (typeof props.offset.x === "number") transforms.push({ translateX: props.offset.x })
    if (typeof props.offset.y === "number") transforms.push({ translateY: props.offset.y })
  }
  if (typeof props.scaleEffect === "number") {
    transforms.push({ scale: props.scaleEffect })
  }
  if (transforms.length > 0) s.transform = transforms

  if (props.style) {
    Object.assign(s, props.style)
  }
  return s
}

export function useModifierRender(
  props: Record<string, any>,
  baseElement: React.ReactElement,
): React.ReactElement {
  const { isDark } = useTheme()
  const {
    onAppear,
    onDisappear,
    onTapGesture,
    overlay,
    background,
    allowsHitTesting,
    contextMenu,
  } = props

  React.useEffect(() => {
    onAppear?.()
    return () => {
      onDisappear?.()
    }
  }, [])

  let node = baseElement

  // Gradient or JSX element background
  const hasGradientBg = background && typeof background === "object" && Array.isArray(background.colors)
  const hasElementBg = React.isValidElement(background)
  const hasOverlay = React.isValidElement(overlay)

  if (hasGradientBg || hasElementBg || hasOverlay) {
    node = (
      <View style={buildViewStyle({ frame: props.frame, clipShape: props.clipShape, cornerRadius: props.cornerRadius, zIndex: props.zIndex }, isDark)} pointerEvents={allowsHitTesting === false ? "none" : "box-none"}>
        {hasGradientBg ? (
          <GradientFillView fill={background} isDark={isDark} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        ) : null}
        {hasElementBg ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
            {background}
          </View>
        ) : null}
        {node}
        {hasOverlay ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
            {overlay}
          </View>
        ) : null}
      </View>
    )
  }

  if (typeof onTapGesture === "function") {
    node = (
      <Pressable onPress={() => onTapGesture()} style={{ flexShrink: 1 }}>
        {node}
      </Pressable>
    )
  }

  if (contextMenu?.menuItems && typeof onTapGesture !== "function") {
    // Allow long-press menu via MenuHost event if needed
  }

  return node
}
