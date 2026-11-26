import React, { useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  NativeModules,
  PanResponder,
  Pressable,
  Image as RNImage,
  RefreshControl,
  ScrollView as RNScrollView,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
  requireNativeComponent,
  useColorScheme as useRNColorScheme,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from "react-native"
import {
  buildViewStyle,
  resolvePaddingStyle,
  sanitizeViewChildren,
  useModifierRender,
} from "./modifiers"
import {
  collectPickerOptions,
  extractMenuItemsFromNode,
  extractTextFromChildren,
  openMenuSheet,
  PresentationHostWrapper,
} from "./overlays"
import { NavChromeReporterContext } from "./navigation"
import { SFSymbolIcon } from "./sfSymbols"
import { GradientFillView } from "./gradients"
import {
  resolveColor,
  resolveFontStyle,
  ThemeContext,
  useTheme,
  type Color,
  type StyledText,
} from "./theme"
import { ScriptingWebViewController } from "./hostGlobals"

const { PixFileSystem } = NativeModules
const HAS_PIX_WEBVIEW = Boolean(UIManager.getViewManagerConfig?.("PixWebView"))
const NativePixWebView: any = HAS_PIX_WEBVIEW
  ? requireNativeComponent("PixWebView")
  : null

// ---------- Theme & Chrome Reporter helper ----------
function useChromeReporter(props: Record<string, any>) {
  const report = useContext(NavChromeReporterContext)
  useEffect(() => {
    if (!report) return
    if (
      props.navigationTitle !== undefined ||
      props.toolbar !== undefined ||
      props.navigationBarVisibility !== undefined
    ) {
      report({
        title: props.navigationTitle,
        toolbar: props.toolbar,
        hideBar: props.navigationBarVisibility === "hidden",
      })
    }
  }, [report, props.navigationTitle, props.toolbar, props.navigationBarVisibility])
}

function withScopedThemeAndChrome(props: Record<string, any>, element: React.ReactElement): React.ReactElement {
  const parentTheme = useTheme()
  const schemeOverride = props.preferredColorScheme ?? props.environments?.colorScheme
  const isDark =
    schemeOverride === "dark" ? true : schemeOverride === "light" ? false : parentTheme.isDark
  const tint = resolveColor(props.tint, isDark) || parentTheme.tint

  let out = element
  if (props.sheet || props.fullScreenCover) {
    out = <PresentationHostWrapper props={props}>{out}</PresentationHostWrapper>
  }
  if (schemeOverride !== undefined || props.tint !== undefined) {
    out = (
      <ThemeContext.Provider
        value={{
          isDark,
          tint,
          colors: parentTheme.colors,
        }}
      >
        {out}
      </ThemeContext.Provider>
    )
  }
  return out
}

// ---------- Hooks ----------
export function useColorScheme(): "light" | "dark" {
  return useRNColorScheme() === "dark" ? "dark" : "light"
}

// ---------- Layout Stacks ----------
export function VStack(props: Record<string, any>) {
  useChromeReporter(props)
  const { isDark } = useTheme()
  const alignMap: Record<string, ViewStyle["alignItems"]> = {
    leading: "flex-start",
    trailing: "flex-end",
    center: "center",
  }
  const style: ViewStyle = {
    flexDirection: "column",
    alignItems: alignMap[props.alignment] ?? "stretch",
    ...(typeof props.spacing === "number" ? { gap: props.spacing } : {}),
    ...buildViewStyle(props, isDark, "vstack"),
  }
  const el = (
    <View style={style} pointerEvents={props.allowsHitTesting === false ? "none" : "auto"}>
      {sanitizeViewChildren(props.children)}
    </View>
  )
  return withScopedThemeAndChrome(props, useModifierRender(props, el))
}

export function HStack(props: Record<string, any>) {
  useChromeReporter(props)
  const { isDark } = useTheme()
  const alignMap: Record<string, ViewStyle["alignItems"]> = {
    top: "flex-start",
    bottom: "flex-end",
    center: "center",
    firstTextBaseline: "baseline",
  }
  const style: ViewStyle = {
    flexDirection: "row",
    alignItems: alignMap[props.alignment] ?? "center",
    ...(typeof props.spacing === "number" ? { gap: props.spacing } : {}),
    ...buildViewStyle(props, isDark, "hstack"),
  }
  const el = (
    <View style={style} pointerEvents={props.allowsHitTesting === false ? "none" : "auto"}>
      {sanitizeViewChildren(props.children)}
    </View>
  )
  return withScopedThemeAndChrome(props, useModifierRender(props, el))
}

export function ZStack(props: Record<string, any>) {
  useChromeReporter(props)
  const { isDark } = useTheme()
  const alignMap: Record<string, ViewStyle> = {
    topLeading: { justifyContent: "flex-start", alignItems: "flex-start" },
    top: { justifyContent: "flex-start", alignItems: "center" },
    topTrailing: { justifyContent: "flex-start", alignItems: "flex-end" },
    leading: { justifyContent: "center", alignItems: "flex-start" },
    center: { justifyContent: "center", alignItems: "center" },
    trailing: { justifyContent: "center", alignItems: "flex-end" },
    bottomLeading: { justifyContent: "flex-end", alignItems: "flex-start" },
    bottom: { justifyContent: "flex-end", alignItems: "center" },
    bottomTrailing: { justifyContent: "flex-end", alignItems: "flex-end" },
  }
  const style: ViewStyle = {
    position: "relative",
    ...(alignMap[props.alignment] ?? { justifyContent: "center", alignItems: "center" }),
    ...buildViewStyle(props, isDark, "zstack"),
  }
  const children = React.Children.toArray(props.children)
  const el = (
    <View style={style} pointerEvents={props.allowsHitTesting === false ? "none" : "box-none"}>
      {children.map((child, idx) => {
        if (!React.isValidElement(child)) return sanitizeViewChildren(child)
        if (idx === 0 && children.length > 1) {
          return child
        }
        return child
      })}
    </View>
  )
  return withScopedThemeAndChrome(props, useModifierRender(props, el))
}

export function LazyVStack(props: Record<string, any>) {
  return <VStack {...props} />
}

export function LazyVGrid(props: Record<string, any>) {
  const { isDark } = useTheme()
  const cols = Array.isArray(props.columns) ? Math.max(1, props.columns.length) : 2
  const spacing = typeof props.spacing === "number" ? props.spacing : 8
  const style: ViewStyle = {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing,
    ...buildViewStyle(props, isDark),
  }
  const items = React.Children.toArray(props.children)
  const el = (
    <View style={style}>
      {items.map((item, idx) => (
        <View key={`grid-${idx}`} style={{ width: `${Math.floor(100 / cols) - 2}%` }}>
          {sanitizeViewChildren(item)}
        </View>
      ))}
    </View>
  )
  return useModifierRender(props, el)
}

export function FlowLayout(props: Record<string, any>) {
  const { isDark } = useTheme()
  const spacing = typeof props.spacing === "number" ? props.spacing : 6
  const style: ViewStyle = {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing,
    ...buildViewStyle(props, isDark),
  }
  const el = <View style={style}>{sanitizeViewChildren(props.children)}</View>
  return useModifierRender(props, el)
}

export function Group(props: Record<string, any>) {
  return <>{props.children}</>
}

export function Spacer(props: Record<string, any>) {
  const minLen = typeof props.minLength === "number" ? props.minLength : 0
  return <View style={{ flex: 1, minWidth: minLen, minHeight: minLen }} pointerEvents="none" />
}

export function Divider(props: Record<string, any>) {
  const { isDark } = useTheme()
  const col = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)"
  return <View style={{ height: StyleSheet.hairlineWidth, width: "100%", backgroundColor: col, ...resolvePaddingStyle(props.padding) }} />
}

export function GeometryReader(props: { children?: (proxy: { size: { width: number; height: number } }) => any }) {
  const { width, height } = useWindowDimensions()
  const [size, setSize] = useState({ width, height })
  return (
    <View
      style={{ flex: 1, width: "100%", height: "100%" }}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout
        if (w > 0 && h > 0 && (Math.abs(w - size.width) > 1 || Math.abs(h - size.height) > 1)) {
          setSize({ width: w, height: h })
        }
      }}
    >
      {typeof props.children === "function" ? props.children({ size }) : null}
    </View>
  )
}

// ---------- ScrollView / List / Section / DisclosureGroup ----------
const ScrollProxyContext = React.createContext<{
  scrollTo: (id: string, anchor?: any) => void
  registerAnchor: (id: string, y: number) => void
} | null>(null)

export function ScrollViewReader(props: { children?: (proxy: { scrollTo: (id: string, anchor?: any) => void }) => any }) {
  const anchorsRef = useRef(new Map<string, number>())
  const scrollViewRef = useRef<RNScrollView | null>(null)
  const proxy = useMemo(() => ({
    scrollTo(id: string) {
      const y = anchorsRef.current.get(id)
      if (typeof y === "number") {
        scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })
      }
    },
    registerAnchor(id: string, y: number) {
      anchorsRef.current.set(id, y)
    },
    attachScrollView(sv: RNScrollView | null) {
      scrollViewRef.current = sv
    },
  }), [])

  return (
    <ScrollProxyContext.Provider value={proxy}>
      {typeof props.children === "function" ? props.children({ scrollTo: proxy.scrollTo }) : null}
    </ScrollProxyContext.Provider>
  )
}

export type ScrollViewProxy = { scrollTo: (id: string, anchor?: any) => void }

export function ScrollViewProxy() {
  return null
}

export function ScrollView(props: Record<string, any>) {
  useChromeReporter(props)
  const { isDark } = useTheme()
  const [refreshing, setRefreshing] = useState(false)
  const isHorizontal = props.axes === "horizontal"
  const proxyCtx: any = useContext(ScrollProxyContext)

  const handleRefresh = typeof props.refreshable === "function"
    ? async () => {
        setRefreshing(true)
        try {
          await props.refreshable()
        } finally {
          setRefreshing(false)
        }
      }
    : undefined

  const style: ViewStyle = {
    flex: isHorizontal ? undefined : 1,
    ...buildViewStyle(props, isDark),
  }

  const el = (
    <RNScrollView
      ref={(ref) => proxyCtx?.attachScrollView?.(ref)}
      horizontal={isHorizontal}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={!isHorizontal}
      scrollEnabled={props.scrollDisabled !== true}
      style={style}
      contentContainerStyle={props.contentMargins?.insets ? resolvePaddingStyle(props.contentMargins.insets) : undefined}
      refreshControl={handleRefresh ? <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} /> : undefined}
    >
      {sanitizeViewChildren(props.children)}
    </RNScrollView>
  )
  return withScopedThemeAndChrome(props, useModifierRender(props, el))
}

export function List(props: Record<string, any>) {
  useChromeReporter(props)
  const { isDark } = useTheme()
  const [refreshing, setRefreshing] = useState(false)
  const bg = props.scrollContentBackground === "hidden"
    ? "transparent"
    : resolveColor("systemGroupedBackground", isDark, "#F2F2F7")

  const handleRefresh = typeof props.refreshable === "function"
    ? async () => {
        setRefreshing(true)
        try {
          await props.refreshable()
        } finally {
          setRefreshing(false)
        }
      }
    : undefined

  const el = (
    <RNScrollView
      style={[{ flex: 1, backgroundColor: bg }, buildViewStyle(props, isDark)]}
      contentContainerStyle={{ padding: 12, gap: props.listSectionSpacing ?? 12 }}
      refreshControl={handleRefresh ? <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} /> : undefined}
    >
      {sanitizeViewChildren(props.children)}
    </RNScrollView>
  )
  return withScopedThemeAndChrome(props, useModifierRender(props, el))
}

export function Section(props: Record<string, any>) {
  const { isDark } = useTheme()
  const cardBg = isDark ? "#1C1C1E" : "#FFFFFF"
  const borderCol = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"
  const subCol = resolveColor("secondaryLabel", isDark, "#6B7280")
  const items = React.Children.toArray(props.children).filter(Boolean)

  return (
    <View style={{ marginBottom: 4 }}>
      {props.header ? (
        <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
          {typeof props.header === "string" ? (
            <RNText style={{ fontSize: 12, fontWeight: "600", color: subCol }}>{props.header}</RNText>
          ) : (
            sanitizeViewChildren(props.header)
          )}
        </View>
      ) : null}
      <View style={{ backgroundColor: cardBg, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: borderCol, overflow: "hidden" }}>
        {items.map((child, idx) => (
          <View
            key={`sec-${idx}`}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 11,
              borderBottomWidth: idx < items.length - 1 ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: borderCol,
            }}
          >
            {sanitizeViewChildren(child)}
          </View>
        ))}
      </View>
      {props.footer ? (
        <View style={{ paddingHorizontal: 10, paddingTop: 6 }}>
          {typeof props.footer === "string" ? (
            <RNText style={{ fontSize: 12, color: subCol }}>{props.footer}</RNText>
          ) : (
            sanitizeViewChildren(props.footer)
          )}
        </View>
      ) : null}
    </View>
  )
}

export function DisclosureGroup(props: {
  isExpanded?: boolean
  onChanged?: (expanded: boolean) => void
  label?: React.ReactNode
  children?: React.ReactNode
}) {
  const { isDark } = useTheme()
  const [localExpanded, setLocalExpanded] = useState(Boolean(props.isExpanded))
  const expanded = props.isExpanded !== undefined ? Boolean(props.isExpanded) : localExpanded
  const toggle = () => {
    const next = !expanded
    if (props.onChanged) props.onChanged(next)
    else setLocalExpanded(next)
  }
  const borderCol = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"

  return (
    <View>
      <TouchableOpacity onPress={toggle} activeOpacity={0.7} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4 }}>
        <View style={{ flex: 1 }}>{sanitizeViewChildren(props.label)}</View>
        <SFSymbolIcon name={expanded ? "chevron.down" : "chevron.right"} size={14} color="#8E8E93" />
      </TouchableOpacity>
      {expanded ? (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderCol, gap: 10 }}>
          {sanitizeViewChildren(props.children)}
        </View>
      ) : null}
    </View>
  )
}

// ---------- Text / Markdown / Label ----------
export function Text(props: Record<string, any>) {
  const { isDark } = useTheme()
  const fg = resolveColor(props.foregroundStyle ?? props.foregroundColor, isDark, isDark ? "#F9FAFB" : "#111827")
  const fontStyle = resolveFontStyle(props.font, props.fontWeight)
  const alignMap: Record<string, TextStyle["textAlign"]> = {
    leading: "left",
    center: "center",
    trailing: "right",
  }
  const textStyle: TextStyle = {
    color: fg,
    fontSize: 15,
    ...fontStyle,
    ...(props.multilineTextAlignment ? { textAlign: alignMap[props.multilineTextAlignment] } : {}),
    ...(typeof props.lineSpacing === "number" ? { lineHeight: (fontStyle.fontSize || 15) + props.lineSpacing + 4 } : {}),
    ...(props.bold ? { fontWeight: "700" } : {}),
    ...(props.italic ? { fontStyle: "italic" } : {}),
    ...(props.underline ? { textDecorationLine: "underline" } : {}),
    ...(props.strikethrough ? { textDecorationLine: "line-through" } : {}),
  }

  let content: React.ReactNode = props.children
  if (Array.isArray(props.styledText) || (props.styledText && typeof props.styledText === "object")) {
    const renderStyledSegment = (
      seg: string | StyledText,
      key: string,
      parentColor?: string,
    ): React.ReactNode => {
      if (typeof seg === "string") {
        return <RNText key={key} style={{ color: parentColor }}>{seg}</RNText>
      }
      const segColor = resolveColor(seg.foregroundColor ?? seg.foregroundStyle, isDark, parentColor)
      const segFont = resolveFontStyle(seg.font, seg.fontWeight)
      const inner = Array.isArray(seg.content)
        ? seg.content.map((child, cIdx) => renderStyledSegment(child, `${key}-${cIdx}`, segColor))
        : (seg.content ?? seg.text ?? "")
      return (
        <RNText
          key={key}
          style={{
            color: segColor,
            ...segFont,
            ...(seg.bold ? { fontWeight: "700" } : {}),
            ...(seg.italic ? { fontStyle: "italic" } : {}),
            ...(seg.underline || seg.underlineStyle ? { textDecorationLine: "underline" } : {}),
            ...(seg.backgroundColor ? { backgroundColor: resolveColor(seg.backgroundColor, isDark) } : {}),
          }}
        >
          {inner}
        </RNText>
      )
    }
    const list = Array.isArray(props.styledText) ? props.styledText : [props.styledText]
    content = list.map((seg: any, idx: number) => renderStyledSegment(seg, `st-${idx}`, fg))
  }

  const extraBoxStyle = buildViewStyle(props, isDark)
  const el = (
    <RNText
      numberOfLines={typeof props.lineLimit === "number" ? props.lineLimit : undefined}
      selectable={Boolean(props.textSelection)}
      style={[textStyle, extraBoxStyle]}
    >
      {content}
    </RNText>
  )
  return useModifierRender(props, el)
}

export function Markdown(props: { content?: string; children?: React.ReactNode; [key: string]: any }) {
  const txt = props.content ?? extractTextFromChildren(props.children)
  return <Text {...props}>{txt}</Text>
}

export function Label(props: {
  title?: string
  systemImage?: string
  foregroundStyle?: Color
  font?: any
  [key: string]: any
}) {
  const { isDark, tint } = useTheme()
  const fg = resolveColor(props.foregroundStyle, isDark, isDark ? "#F9FAFB" : "#111827") || "#111827"
  const fontStyle = resolveFontStyle(props.font, props.fontWeight)
  const iconSize = fontStyle.fontSize || 16
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 6 }, buildViewStyle(props, isDark)]}>
      {props.systemImage ? <SFSymbolIcon name={props.systemImage} size={iconSize} color={fg || tint} /> : null}
      {props.title ? <RNText style={[{ color: fg, fontSize: 15 }, fontStyle]}>{props.title}</RNText> : sanitizeViewChildren(props.children)}
    </View>
  )
}

// ---------- Image ----------
export function Image(props: Record<string, any>) {
  const { isDark } = useTheme()
  const fg = resolveColor(props.foregroundStyle, isDark, isDark ? "#F9FAFB" : "#111827") || "#111827"
  const fontStyle = resolveFontStyle(props.font, props.fontWeight)

  if (props.systemName) {
    const icon = (
      <View style={[{ alignItems: "center", justifyContent: "center" }, buildViewStyle(props, isDark)]}>
        <SFSymbolIcon name={props.systemName} size={fontStyle.fontSize || 18} color={fg} />
      </View>
    )
    return useModifierRender(props, icon)
  }

  let uri: string | undefined
  let blurRadius: number | undefined
  if (typeof props.filePath === "string" && props.filePath) {
    uri = props.filePath.startsWith("file://") || props.filePath.startsWith("http") || props.filePath.startsWith("data:")
      ? props.filePath
      : `file://${props.filePath}`
  } else if (typeof props.imageUrl === "string" && props.imageUrl) {
    uri = props.imageUrl
  } else if (props.image) {
    if (props.image.symbolName) {
      return <Image {...props} systemName={props.image.symbolName} image={undefined} />
    }
    if (props.image.filePath) {
      uri = props.image.filePath.startsWith("file://") ? props.image.filePath : `file://${props.image.filePath}`
    } else if (props.image.base64) {
      uri = `data:image/jpeg;base64,${props.image.base64}`
    }
    if (typeof props.image.blurRadius === "number") {
      blurRadius = props.image.blurRadius
    }
  }

  const resizeMode =
    props.aspectRatio?.contentMode === "fill" ? "cover" : "contain"

  const style: any = {
    width: props.frame?.width ?? (props.resizable ? "100%" : undefined),
    height: props.frame?.height ?? (props.resizable ? "100%" : undefined),
    ...buildViewStyle(props, isDark),
  }

  const imgEl = uri ? (
    <RNImage
      source={{ uri }}
      resizeMode={resizeMode}
      blurRadius={blurRadius}
      style={style}
    />
  ) : (
    <View style={[style, { backgroundColor: "rgba(128,128,128,0.12)" }]} />
  )
  return useModifierRender(props, imgEl)
}

// ---------- Controls: Button / Link / Menu / Picker / Toggle / Slider / TextField ----------
export function Button(props: Record<string, any>) {
  const { isDark, tint } = useTheme()
  const isDisabled = Boolean(props.disabled)
  const isDestructive = props.role === "destructive"
  const buttonStyle = props.buttonStyle || "automatic"
  const isBorderedProminent = buttonStyle === "borderedProminent"
  const isGlass = buttonStyle === "glass" || Boolean(props.glassEffect)

  const fg = isBorderedProminent
    ? "#FFFFFF"
    : isDestructive
      ? "#FF3B30"
      : resolveColor(props.foregroundStyle, isDark, tint) || tint

  const containerStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    opacity: isDisabled ? 0.45 : 1,
    ...(isBorderedProminent
      ? { backgroundColor: isDestructive ? "#FF3B30" : tint, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 }
      : buttonStyle === "bordered"
        ? { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 }
        : isGlass
          ? { backgroundColor: isDark ? "rgba(44,44,46,0.8)" : "rgba(255,255,255,0.85)", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, borderWidth: 0.75, borderColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)" }
          : {}),
    ...buildViewStyle(props, isDark),
  }

  const handlePress = () => {
    if (isDisabled) return
    if (typeof props.action === "function") {
      props.action()
    }
    if (props.contextMenu?.menuItems && typeof props.action !== "function") {
      const items = extractMenuItemsFromNode(props.contextMenu.menuItems)
      if (items.length > 0) openMenuSheet({ items })
    }
  }

  const handleLongPress = () => {
    if (isDisabled || !props.contextMenu?.menuItems) return
    const items = extractMenuItemsFromNode(props.contextMenu.menuItems)
    if (items.length > 0) openMenuSheet({ items })
  }

  return (
    <TouchableOpacity
      activeOpacity={0.65}
      disabled={isDisabled}
      onPress={handlePress}
      onLongPress={props.contextMenu?.menuItems ? handleLongPress : undefined}
      style={containerStyle}
    >
      {props.systemImage ? <SFSymbolIcon name={props.systemImage} size={16} color={fg} /> : null}
      {typeof props.title === "string" ? (
        <RNText style={{ color: fg, fontSize: 15, fontWeight: isBorderedProminent ? "600" : "500" }}>
          {props.title}
        </RNText>
      ) : null}
      {sanitizeViewChildren(props.children)}
    </TouchableOpacity>
  )
}
Button.displayName = "ScriptingButton"

export function Link(props: { url?: string; title?: string; children?: React.ReactNode; [key: string]: any }) {
  const { tint } = useTheme()
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        if (props.url) Linking.openURL(props.url).catch(() => {})
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
    >
      {props.title ? <RNText style={{ color: tint, fontSize: 15 }}>{props.title}</RNText> : sanitizeViewChildren(props.children)}
    </TouchableOpacity>
  )
}

export function Menu(props: {
  title?: string
  systemImage?: string
  label?: React.ReactNode
  children?: React.ReactNode
  [key: string]: any
}) {
  const { isDark, tint } = useTheme()
  const items = extractMenuItemsFromNode(props.children)
  const trigger = () => {
    if (items.length > 0) {
      openMenuSheet({ title: props.title, items })
    }
  }

  return (
    <TouchableOpacity
      activeOpacity={0.65}
      onPress={trigger}
      style={[{ flexDirection: "row", alignItems: "center", gap: 4 }, buildViewStyle(props, isDark)]}
    >
      {props.label ? (
        sanitizeViewChildren(props.label)
      ) : (
        <>
          {props.systemImage ? <SFSymbolIcon name={props.systemImage} size={16} color={tint} /> : null}
          {props.title ? <RNText style={{ color: tint, fontSize: 15, fontWeight: "500" }}>{props.title}</RNText> : null}
        </>
      )}
    </TouchableOpacity>
  )
}
Menu.displayName = "ScriptingMenu"

export function Picker(props: {
  title?: string
  value?: any
  onChanged?: (value: any) => void
  pickerStyle?: string
  children?: React.ReactNode
  [key: string]: any
}) {
  const { isDark, tint } = useTheme()
  const options = collectPickerOptions(props.children)
  const selected = options.find((o) => o.value === props.value) ?? options[0]
  const textCol = isDark ? "#F9FAFB" : "#111827"
  const subCol = isDark ? "#9CA3AF" : "#6B7280"

  if (props.pickerStyle === "segmented") {
    const trackBg = isDark ? "rgba(118,118,128,0.24)" : "rgba(120,120,128,0.14)"
    const activeBg = isDark ? "#3A3A3C" : "#FFFFFF"
    return (
      <View style={[{ flexDirection: "row", backgroundColor: trackBg, borderRadius: 10, padding: 3, gap: 3 }, buildViewStyle(props, isDark)]}>
        {options.map((opt, idx) => {
          const isActive = opt.value === props.value
          return (
            <Pressable
              key={`seg-${idx}`}
              onPress={() => props.onChanged?.(opt.value)}
              style={{
                flex: 1,
                paddingVertical: 6,
                paddingHorizontal: 8,
                borderRadius: 8,
                alignItems: "center",
                backgroundColor: isActive ? activeBg : "transparent",
              }}
            >
              <RNText numberOfLines={1} style={{ fontSize: 13, fontWeight: isActive ? "600" : "400", color: isActive ? textCol : subCol }}>
                {opt.label}
              </RNText>
            </Pressable>
          )
        })}
      </View>
    )
  }

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        openMenuSheet({
          title: props.title,
          items: options.map((o) => ({
            title: o.label,
            checked: o.value === props.value,
            action: () => props.onChanged?.(o.value),
          })),
        })
      }}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 4 }}
    >
      {props.title ? <RNText style={{ fontSize: 15, color: textCol }}>{props.title}</RNText> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <RNText style={{ fontSize: 14, color: tint }}>{selected?.label ?? String(props.value ?? "")}</RNText>
        <SFSymbolIcon name="chevron.up.chevron.down" size={13} color={tint} />
      </View>
    </TouchableOpacity>
  )
}
Picker.displayName = "ScriptingPicker"

export function Toggle(props: {
  title?: string
  value?: boolean
  onChanged?: (val: boolean) => void
  children?: React.ReactNode
  [key: string]: any
}) {
  const { isDark, tint } = useTheme()
  const textCol = isDark ? "#F9FAFB" : "#111827"
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <View style={{ flex: 1 }}>
        {props.title ? <RNText style={{ fontSize: 15, color: textCol }}>{props.title}</RNText> : sanitizeViewChildren(props.children)}
      </View>
      <Switch
        value={Boolean(props.value)}
        onValueChange={(v) => props.onChanged?.(v)}
        trackColor={{ false: isDark ? "#3A3A3C" : "#D1D5DB", true: tint }}
      />
    </View>
  )
}

export function Slider(props: {
  value?: number
  min?: number
  max?: number
  step?: number
  onChanged?: (val: number) => void
  [key: string]: any
}) {
  const { isDark, tint } = useTheme()
  const min = props.min ?? 0
  const max = props.max ?? 1
  const span = Math.max(0.0001, max - min)
  const val = Math.max(min, Math.min(max, props.value ?? min))
  const trackWidthRef = useRef(200)

  const updateFromX = (x: number) => {
    const ratio = Math.max(0, Math.min(1, x / Math.max(1, trackWidthRef.current)))
    let next = min + ratio * span
    if (typeof props.step === "number" && props.step > 0) {
      next = Math.round((next - min) / props.step) * props.step + min
    }
    props.onChanged?.(Number(next.toFixed(4)))
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => updateFromX(e.nativeEvent.locationX),
        onPanResponderMove: (e) => updateFromX(e.nativeEvent.locationX),
      }),
    [min, span, props.step],
  )

  const pct = ((val - min) / span) * 100
  return (
    <View
      onLayout={(e) => {
        trackWidthRef.current = e.nativeEvent.layout.width
      }}
      {...panResponder.panHandlers}
      style={{ height: 32, justifyContent: "center", width: "100%" }}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: isDark ? "#3A3A3C" : "#D1D5DB" }}>
        <View style={{ height: 4, borderRadius: 2, width: `${pct}%`, backgroundColor: tint }} />
      </View>
      <View
        style={{
          position: "absolute",
          left: `${pct}%`,
          marginLeft: -10,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.18)",
          elevation: 2,
        }}
      />
    </View>
  )
}

export function TextField(props: {
  title?: string
  prompt?: string
  value?: string
  onChanged?: (val: string) => void
  onSubmit?: () => void
  [key: string]: any
}) {
  const { isDark } = useTheme()
  const textCol = isDark ? "#F9FAFB" : "#111827"
  const subCol = isDark ? "#8E8E93" : "#9CA3AF"
  const bg = isDark ? "rgba(118,118,128,0.22)" : "rgba(120,120,128,0.10)"

  return (
    <TextInput
      value={props.value ?? ""}
      onChangeText={(t) => props.onChanged?.(t)}
      onSubmitEditing={() => props.onSubmit?.()}
      placeholder={props.prompt ?? props.title ?? ""}
      placeholderTextColor={subCol}
      secureTextEntry={Boolean(props.secure)}
      autoCapitalize="none"
      autoCorrect={false}
      style={[
        {
          color: textCol,
          backgroundColor: bg,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 9,
          fontSize: 15,
          minWidth: 120,
        },
        buildViewStyle(props, isDark),
      ]}
    />
  )
}

export function SecureField(props: Record<string, any>) {
  return <TextField {...props} secure={true} />
}

export function DatePicker(props: {
  title?: string
  value?: Date | number | string
  onChanged?: (d: any) => void
  [key: string]: any
}) {
  const { isDark, tint } = useTheme()
  const d = props.value instanceof Date ? props.value : props.value ? new Date(props.value) : new Date()
  const formatted = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      {props.title ? <RNText style={{ fontSize: 15, color: isDark ? "#F9FAFB" : "#111827" }}>{props.title}</RNText> : null}
      <TextInput
        value={formatted}
        onChangeText={(txt) => {
          const parsed = new Date(txt)
          if (!isNaN(parsed.getTime())) props.onChanged?.(parsed)
        }}
        placeholder="YYYY-MM-DD"
        style={{
          color: tint,
          fontSize: 14,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 8,
          backgroundColor: isDark ? "#2C2C2E" : "#F3F4F6",
        }}
      />
    </View>
  )
}

export function ColorPicker(props: { title?: string; value?: string; onChanged?: (c: string) => void }) {
  const { isDark } = useTheme()
  const swatches = ["#007AFF", "#FF2D55", "#AF52DE", "#34C759", "#FF9500", "#06B6D4"]
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      {props.title ? <RNText style={{ fontSize: 15, color: isDark ? "#F9FAFB" : "#111827" }}>{props.title}</RNText> : null}
      <View style={{ flexDirection: "row", gap: 6 }}>
        {swatches.map((hex) => (
          <Pressable
            key={hex}
            onPress={() => props.onChanged?.(hex)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: hex,
              borderWidth: props.value === hex ? 2 : 0,
              borderColor: isDark ? "#FFF" : "#111",
            }}
          />
        ))}
      </View>
    </View>
  )
}

export function ProgressView(props: { value?: number; total?: number; progressViewStyle?: string; [key: string]: any }) {
  const { isDark, tint } = useTheme()
  if (typeof props.value === "number") {
    const total = props.total && props.total > 0 ? props.total : 1
    const pct = Math.max(0, Math.min(100, (props.value / total) * 100))
    return (
      <View style={[{ height: 4, width: "100%", borderRadius: 2, backgroundColor: isDark ? "#3A3A3C" : "#E5E7EB", overflow: "hidden" }, buildViewStyle(props, isDark)]}>
        <View style={{ height: 4, width: `${pct}%`, backgroundColor: tint }} />
      </View>
    )
  }
  return <ActivityIndicator size={props.controlSize === "large" ? "large" : "small"} color={tint} />
}

// ---------- Shapes & Ambient Helpers ----------
export function Rectangle(props: Record<string, any>) {
  const { isDark } = useTheme()
  const style = buildViewStyle(props, isDark)
  if (props.fill && typeof props.fill === "object" && Array.isArray(props.fill.colors)) {
    return useModifierRender(props, <GradientFillView fill={props.fill} isDark={isDark} style={[{ width: "100%", height: "100%" }, style]} />)
  }
  const fillCol = resolveColor(props.fill, isDark, "transparent")
  const el = <View style={[{ width: "100%", height: "100%", backgroundColor: fillCol }, style]} pointerEvents="none" />
  return useModifierRender(props, el)
}

export function RoundedRectangle(props: Record<string, any>) {
  return <Rectangle {...props} cornerRadius={props.cornerRadius ?? 12} />
}

export function Circle(props: Record<string, any>) {
  return <Rectangle {...props} cornerRadius={9999} />
}

export function Capsule(props: Record<string, any>) {
  return <Rectangle {...props} cornerRadius={9999} />
}

export function Ellipse(props: Record<string, any>) {
  return <Rectangle {...props} cornerRadius={9999} />
}

export type Shape = any

export function Shape(props: Record<string, any>) {
  return <Rectangle {...props} />
}

export function GlassEffectContainer(props: { children?: React.ReactNode; [key: string]: any }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, buildViewStyle(props, useTheme().isDark)]}>{sanitizeViewChildren(props.children)}</View>
}

export function NamespaceReader(props: { children?: (ns: any) => any }) {
  return <>{typeof props.children === "function" ? props.children("pix-ns") : null}</>
}

// ---------- Canvas & TimelineCanvas (OCR + Ugoira frame playback) ----------
export function Canvas(props: Record<string, any>) {
  // Marker view; OCR ImageRenderer extracts __ocrRenderDescriptor via draw callback inspection
  const { isDark } = useTheme()
  return <View style={[{ width: "100%", height: "100%" }, buildViewStyle(props, isDark)]} />
}

export function TimelineCanvas(props: {
  draw?: (ctx: any, size: { width: number; height: number }, timeSec: number) => void
  frame?: any
}) {
  const [size, setSize] = useState({ width: 300, height: 300 })
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    if (!props.draw) return
    let active = true
    const tick = () => {
      if (!active) return
      const elapsedSec = (Date.now() - startRef.current) / 1000
      let drawnPath: string | null = null
      const mockCtx = {
        drawImage(src: any) {
          if (src?.filePath) drawnPath = src.filePath
        },
      }
      try {
        props.draw?.(mockCtx, size, elapsedSec)
      } catch {}
      if (drawnPath && drawnPath !== currentFile) {
        setCurrentFile(drawnPath)
      }
    }
    tick()
    const timer = setInterval(tick, 40)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [props.draw, size])

  return (
    <View
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        if (width > 0 && height > 0) setSize({ width, height })
      }}
      style={{ flex: 1, width: "100%", height: "100%", justifyContent: "center", alignItems: "center" }}
    >
      {currentFile ? (
        <RNImage
          source={{ uri: currentFile.startsWith("file://") ? currentFile : `file://${currentFile}` }}
          resizeMode="contain"
          fadeDuration={0}
          style={{ width: "100%", height: "100%" }}
        />
      ) : null}
    </View>
  )
}

// ---------- Embedded WebView ----------
export function WebView(props: {
  controller?: ScriptingWebViewController | null
  frame?: any
  [key: string]: any
}) {
  const { isDark } = useTheme()
  const [htmlPayload, setHtmlPayload] = useState<{ html: string; generation: number } | null>(null)
  const [evalQueue, setEvalQueue] = useState<Array<{ id: number; script: string }>>([])
  const evalSeq = useRef(1)
  const pendingLoadResolvers = useRef(new Map<number, (ok: boolean) => void>())

  useEffect(() => {
    const ctrl = props.controller
    if (!ctrl) return
    ctrl._attachMountedSink({
      onLoadHTML(html: string, generation: number) {
        return new Promise<boolean>((resolve) => {
          pendingLoadResolvers.current.set(generation, resolve)
          setHtmlPayload({ html, generation })
          setTimeout(() => {
            const pending = pendingLoadResolvers.current.get(generation)
            if (pending) {
              pendingLoadResolvers.current.delete(generation)
              pending(true)
            }
          }, 5000)
        })
      },
      async onEvaluateJS(script: string) {
        const id = evalSeq.current++
        setEvalQueue((prev) => [...prev.slice(-24), { id, script }])
        return null
      },
    })
    return () => {
      ctrl._attachMountedSink(null)
      pendingLoadResolvers.current.forEach((res) => res(false))
      pendingLoadResolvers.current.clear()
    }
  }, [props.controller])

  if (!NativePixWebView) {
    return <View style={{ flex: 1, backgroundColor: isDark ? "#000" : "#FFF" }} />
  }

  return (
    <NativePixWebView
      htmlPayload={htmlPayload}
      evalQueue={evalQueue}
      onScriptMessage={(e: any) => {
        const { name, payload } = e.nativeEvent || {}
        if (name) {
          props.controller?._dispatchMessage(name, payload)
        }
      }}
      onLoadComplete={(e: any) => {
        const { generation, success } = e.nativeEvent || {}
        const res = pendingLoadResolvers.current.get(generation)
        if (res) {
          pendingLoadResolvers.current.delete(generation)
          res(Boolean(success))
        }
      }}
      style={[{ flex: 1, width: "100%", height: "100%" }, buildViewStyle(props, isDark)]}
    />
  )
}

// ---------- Gesture stubs (chainable builders) ----------
function makeGestureBuilder() {
  const builder: any = {
    onChanged: () => builder,
    onEnded: () => builder,
    simultaneouslyWith: () => builder,
  }
  return builder
}
export function DragGesture(_opts?: any) {
  return makeGestureBuilder()
}
export function MagnifyGesture(_min?: any) {
  return makeGestureBuilder()
}
export function TapGesture(_count?: any) {
  return makeGestureBuilder()
}
export function LongPressGesture(_opts?: any) {
  return makeGestureBuilder()
}
