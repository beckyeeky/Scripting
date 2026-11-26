import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  BackHandler,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native"
import {
  DismissContext,
  PresentationHostWrapper,
  dismissTopPresentedModal,
  pushPresentedModal,
} from "./overlays"
import { sanitizeViewChildren } from "./modifiers"
import { SFSymbolIcon } from "./sfSymbols"
import { resolveColor, useTheme } from "./theme"

// ---------- Observable & useObservable ----------
export interface Observable<T> {
  readonly value: T
  setValue: (next: T | ((prev: T) => T)) => void
  subscribe: (listener: (value: T) => void) => () => void
}

export function useObservable<T>(initialValue: T | (() => T)): Observable<T> {
  const valueRef = useRef<T>(
    typeof initialValue === "function" ? (initialValue as () => T)() : initialValue,
  )
  const listenersRef = useRef(new Set<(val: T) => void>())
  const [, setTick] = useState(0)

  const obs = useMemo<Observable<T>>(() => ({
    get value() {
      return valueRef.current
    },
    setValue(next: T | ((prev: T) => T)) {
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next
      if (Object.is(resolved, valueRef.current)) return
      valueRef.current = resolved
      setTick((t) => t + 1)
      listenersRef.current.forEach((fn) => {
        try {
          fn(resolved)
        } catch {}
      })
    },
    subscribe(listener: (value: T) => void) {
      listenersRef.current.add(listener)
      return () => {
        listenersRef.current.delete(listener)
      }
    },
  }), [])

  return obs
}

// ---------- Android Hardware Back Coordinator ----------
type BackHandlerEntry = () => boolean
const backStackHandlers: BackHandlerEntry[] = []

let backListenerRegistered = false
export function ensureGlobalBackHandler(): void {
  if (backListenerRegistered) return
  backListenerRegistered = true
  BackHandler.addEventListener("hardwareBackPress", () => {
    if (dismissTopPresentedModal()) return true
    for (let i = backStackHandlers.length - 1; i >= 0; i--) {
      if (backStackHandlers[i]()) return true
    }
    return false
  })
}

// ---------- Navigation Contexts ----------
interface NavStackContextValue {
  push: (route: string) => void
  pop: () => void
  canGoBack: boolean
  tint?: string
}

const NavStackContext = React.createContext<NavStackContextValue>({
  push: () => {},
  pop: () => {},
  canGoBack: false,
})

// Extract navigationTitle, navigationDestination, toolbar, navigationBarVisibility from root/pushed element
function extractPageChrome(node: any): {
  title?: string
  toolbar?: any
  hideBar?: boolean
  destinationResolver?: (path: string) => React.ReactNode
} {
  let title: string | undefined
  let toolbar: any
  let hideBar = false
  let destinationResolver: ((path: string) => React.ReactNode) | undefined

  function inspect(n: any, depth: number) {
    if (!n || depth > 3) return
    if (Array.isArray(n)) {
      n.forEach((c) => inspect(c, depth))
      return
    }
    if (!React.isValidElement(n)) return
    const p: any = n.props || {}
    if (typeof p.navigationTitle === "string" && title === undefined) title = p.navigationTitle
    if (p.toolbar && !toolbar) toolbar = p.toolbar
    if (p.navigationBarVisibility === "hidden") hideBar = true
    if (p.navigationDestination) {
      if (typeof p.navigationDestination === "function") {
        destinationResolver = p.navigationDestination
      } else if (React.isValidElement(p.navigationDestination)) {
        const dp: any = p.navigationDestination.props || {}
        if (typeof dp.children === "function") destinationResolver = dp.children
      }
    }
    if (p.children && !destinationResolver) {
      inspect(p.children, depth + 1)
    }
  }
  inspect(node, 0)
  return { title, toolbar, hideBar, destinationResolver }
}

export function NavigationDestination(props: { children?: (path: string) => any }) {
  // Marker element inspected by NavigationStack; renders nothing on its own.
  return null
}

function renderToolbarSlot(slot: any): React.ReactNode {
  if (!slot) return null
  if (Array.isArray(slot)) {
    return (
      <View style={styles.toolbarSlotRow}>
        {slot.map((item, idx) => (
          <View key={`tb-${idx}`} style={styles.toolbarItem}>
            {sanitizeViewChildren(item)}
          </View>
        ))}
      </View>
    )
  }
  return <View style={styles.toolbarSlotRow}>{sanitizeViewChildren(slot)}</View>
}

function NavScreenFrame({
  element,
  canGoBack,
  onPop,
  fallbackResolver,
  onRegisterResolver,
}: {
  element: React.ReactElement
  canGoBack: boolean
  onPop: () => void
  fallbackResolver?: (path: string) => React.ReactNode
  onRegisterResolver?: (fn: (path: string) => React.ReactNode) => void
}) {
  const { isDark, tint } = useTheme()
  const [chrome, setChrome] = useState<{
    title?: string
    toolbar?: any
    hideBar?: boolean
  }>({})

  const inspected = extractPageChrome(element)
  useEffect(() => {
    if (inspected.destinationResolver && onRegisterResolver) {
      onRegisterResolver(inspected.destinationResolver)
    }
  }, [inspected.destinationResolver, onRegisterResolver])

  const title = chrome.title ?? inspected.title
  const toolbar = chrome.toolbar ?? inspected.toolbar
  const hideBar = chrome.hideBar ?? inspected.hideBar

  const showHeader = !hideBar && (canGoBack || Boolean(title) || Boolean(toolbar?.topBarLeading) || Boolean(toolbar?.topBarTrailing) || Boolean(toolbar?.principal))
  const barBg = isDark ? "rgba(22,22,24,0.94)" : "rgba(248,248,250,0.95)"
  const borderCol = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)"
  const titleColor = isDark ? "#F9FAFB" : "#111827"

  return (
    <View style={[styles.screenWrap, { backgroundColor: resolveColor("systemBackground", isDark, "#F2F2F7") }]}>
      {showHeader ? (
        <View style={[styles.navBar, { backgroundColor: barBg, borderBottomColor: borderCol }]}>
          <View style={styles.navLeft}>
            {canGoBack ? (
              <TouchableOpacity onPress={onPop} style={styles.backBtn} hitSlop={8}>
                <SFSymbolIcon name="chevron.left" size={20} color={tint} />
                <RNText style={[styles.backText, { color: tint }]}>返回</RNText>
              </TouchableOpacity>
            ) : null}
            {renderToolbarSlot(toolbar?.topBarLeading)}
          </View>
          <View style={styles.navCenter} pointerEvents="box-none">
            {toolbar?.principal ? (
              <View style={styles.principalWrap}>{sanitizeViewChildren(toolbar.principal)}</View>
            ) : title ? (
              <RNText numberOfLines={1} style={[styles.navTitle, { color: titleColor }]}>
                {title}
              </RNText>
            ) : null}
          </View>
          <View style={styles.navRight}>{renderToolbarSlot(toolbar?.topBarTrailing)}</View>
        </View>
      ) : null}
      <View style={styles.screenBody}>
        <NavChromeReporterContext.Provider value={setChrome}>
          {element}
        </NavChromeReporterContext.Provider>
      </View>
    </View>
  )
}

export const NavChromeReporterContext = React.createContext<
  ((chrome: { title?: string; toolbar?: any; hideBar?: boolean }) => void) | null
>(null)

export function NavigationStack(props: {
  path?: Observable<string[]>
  tint?: string
  children?: React.ReactNode
  [key: string]: any
}) {
  const internalPath = useObservable<string[]>([])
  const pathObs = props.path ?? internalPath
  const [routes, setRoutes] = useState<string[]>(() => pathObs.value || [])
  const resolverRef = useRef<((path: string) => React.ReactNode) | null>(null)
  const parentTheme = useTheme()

  useEffect(() => {
    ensureGlobalBackHandler()
    setRoutes(pathObs.value || [])
    return pathObs.subscribe((next) => {
      setRoutes(Array.isArray(next) ? next : [])
    })
  }, [pathObs])

  const push = useCallback((route: string) => {
    const cur = pathObs.value || []
    if (cur.length > 0 && cur[cur.length - 1] === route) return
    pathObs.setValue([...cur, route])
  }, [pathObs])

  const pop = useCallback(() => {
    const cur = pathObs.value || []
    if (cur.length === 0) return
    pathObs.setValue(cur.slice(0, cur.length - 1))
  }, [pathObs])

  useEffect(() => {
    const handler = () => {
      if ((pathObs.value || []).length > 0) {
        pop()
        return true
      }
      return false
    }
    backStackHandlers.push(handler)
    return () => {
      const idx = backStackHandlers.indexOf(handler)
      if (idx >= 0) backStackHandlers.splice(idx, 1)
    }
  }, [pathObs, pop])

  const resolvedTint = resolveColor(props.tint, parentTheme.isDark) || parentTheme.tint
  const navCtx = useMemo<NavStackContextValue>(() => ({
    push,
    pop,
    canGoBack: routes.length > 0,
    tint: resolvedTint,
  }), [push, pop, routes.length, resolvedTint])

  const rootChild = React.Children.toArray(props.children)[0] as React.ReactElement | undefined

  const registerResolver = useCallback((fn: (p: string) => React.ReactNode) => {
    resolverRef.current = fn
  }, [])

  const body = (
    <NavStackContext.Provider value={navCtx}>
      <View style={styles.stackRoot}>
        {rootChild ? (
          <View style={[styles.stackLayer, { display: routes.length === 0 ? "flex" : "none" }]}>
            <NavScreenFrame
              element={rootChild}
              canGoBack={false}
              onPop={pop}
              onRegisterResolver={registerResolver}
            />
          </View>
        ) : null}
        {routes.map((route, idx) => {
          const isTop = idx === routes.length - 1
          let destNode: React.ReactNode = resolverRef.current?.(route)
          if (!destNode) {
            try {
              const { renderDestination } = require("../../../../Pix-Scripting/src/store/routeNavigation")
              destNode = renderDestination(route)
            } catch {}
          }
          if (!React.isValidElement(destNode)) {
            destNode = (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <RNText style={{ color: "#8E8E93" }}>页面未找到: {route}</RNText>
              </View>
            )
          }
          return (
            <View
              key={`route-${idx}-${route}`}
              style={[styles.stackLayer, { display: isTop ? "flex" : "none" }]}
            >
              <NavScreenFrame
                element={destNode as React.ReactElement}
                canGoBack={true}
                onPop={pop}
              />
            </View>
          )
        })}
      </View>
    </NavStackContext.Provider>
  )

  return <PresentationHostWrapper props={props}>{body}</PresentationHostWrapper>
}

export function NavigationLink(props: {
  value?: string
  destination?: React.ReactNode
  buttonStyle?: string
  frame?: any
  children?: React.ReactNode
  [key: string]: any
}) {
  const { push } = useContext(NavStackContext)
  return (
    <TouchableOpacity
      activeOpacity={0.65}
      onPress={() => {
        if (props.value) push(props.value)
      }}
      style={props.frame?.maxWidth === "infinity" ? { width: "100%" } : undefined}
    >
      {sanitizeViewChildren(props.children)}
    </TouchableOpacity>
  )
}

export const Navigation = {
  async present(opts: { element: React.ReactElement; modalPresentationStyle?: string }): Promise<void> {
    const fullScreen = opts.modalPresentationStyle === "fullScreen"
    await pushPresentedModal(opts.element, fullScreen)
  },
  useDismiss(): () => void {
    const modalDismiss = useContext(DismissContext)
    const nav = useContext(NavStackContext)
    return useCallback(() => {
      if (nav.canGoBack) {
        nav.pop()
      } else {
        modalDismiss()
      }
    }, [nav, modalDismiss])
  },
}

// ---------- TabView & Tab ----------
export function Tab(props: {
  title?: string
  systemImage?: string
  value?: any
  role?: string
  children?: React.ReactNode
}) {
  return <View style={styles.tabContent}>{sanitizeViewChildren(props.children)}</View>
}

export function TabView(props: {
  selection?: Observable<any>
  tabIndex?: number
  onTabIndexChanged?: (index: number) => void
  tabViewStyle?: string
  tabViewBottomAccessory?: React.ReactNode
  scrollDisabled?: boolean
  tint?: string
  children?: React.ReactNode
  [key: string]: any
}) {
  const { isDark, tint } = useTheme()
  const { width: windowWidth } = useWindowDimensions()
  const childElements = React.Children.toArray(props.children).filter(React.isValidElement) as React.ReactElement[]

  const isPaged =
    typeof props.tabViewStyle === "string" &&
    props.tabViewStyle.startsWith("page")

  // Paged mode (used by IllustGalleryView)
  const pagerRef = useRef<ScrollView>(null)
  const lastReportedIndex = useRef<number>(props.tabIndex ?? 0)

  useEffect(() => {
    if (!isPaged || typeof props.tabIndex !== "number") return
    if (props.tabIndex !== lastReportedIndex.current) {
      lastReportedIndex.current = props.tabIndex
      pagerRef.current?.scrollTo({ x: props.tabIndex * windowWidth, animated: true })
    }
  }, [isPaged, props.tabIndex, windowWidth])

  if (isPaged) {
    const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (windowWidth <= 0) return
      const idx = Math.round(e.nativeEvent.contentOffset.x / windowWidth)
      if (idx !== lastReportedIndex.current) {
        lastReportedIndex.current = idx
        props.onTabIndexChanged?.(idx)
      }
    }
    return (
      <ScrollView
        ref={pagerRef}
        horizontal={true}
        pagingEnabled={true}
        scrollEnabled={!props.scrollDisabled}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        contentOffset={{ x: (props.tabIndex ?? 0) * windowWidth, y: 0 }}
        style={{ flex: 1 }}
      >
        {childElements.map((child, i) => (
          <View key={child.key ?? `page-${i}`} style={{ width: windowWidth, height: "100%" }}>
            {child}
          </View>
        ))}
      </ScrollView>
    )
  }

  // Tab Bar Mode (MainTabView)
  const tabDefs = childElements.map((el, i) => {
    const p: any = el.props || {}
    return {
      key: String(p.value ?? i),
      value: p.value ?? i,
      title: p.title || `Tab ${i + 1}`,
      systemImage: p.systemImage || "circle.grid.2x2.fill",
      role: p.role,
      element: el,
    }
  })

  const [selectedVal, setSelectedVal] = useState<any>(
    () => props.selection?.value ?? tabDefs[0]?.value,
  )
  const visitedRef = useRef(new Set<string>([String(selectedVal)]))

  useEffect(() => {
    if (!props.selection) return
    setSelectedVal(props.selection.value)
    visitedRef.current.add(String(props.selection.value))
    return props.selection.subscribe((val) => {
      visitedRef.current.add(String(val))
      setSelectedVal(val)
    })
  }, [props.selection])

  const selectTab = (val: any) => {
    visitedRef.current.add(String(val))
    setSelectedVal(val)
    props.selection?.setValue(val)
  }

  const activeTint = resolveColor(props.tint, isDark) || tint
  const barBg = isDark ? "rgba(22,22,26,0.95)" : "rgba(255,255,255,0.95)"
  const borderCol = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)"
  const inactiveCol = isDark ? "#8E8E93" : "#6B7280"

  return (
    <View style={styles.tabViewRoot}>
      <View style={styles.tabViewStage}>
        {tabDefs.map((tab) => {
          const isCurrent = tab.value === selectedVal
          if (!visitedRef.current.has(tab.key) && !isCurrent) return null
          return (
            <View
              key={tab.key}
              style={[styles.tabPane, { display: isCurrent ? "flex" : "none" }]}
            >
              {tab.element}
            </View>
          )
        })}
      </View>

      {props.tabViewBottomAccessory ? (
        <View style={styles.bottomAccessoryWrap} pointerEvents="box-none">
          {props.tabViewBottomAccessory}
        </View>
      ) : null}

      <View style={[styles.tabBar, { backgroundColor: barBg, borderTopColor: borderCol }]}>
        {tabDefs.map((tab) => {
          const isCurrent = tab.value === selectedVal
          const col = isCurrent ? activeTint : inactiveCol
          return (
            <Pressable
              key={tab.key}
              onPress={() => selectTab(tab.value)}
              style={styles.tabBarItem}
            >
              <SFSymbolIcon name={tab.systemImage} size={20} color={col} />
              <RNText numberOfLines={1} style={[styles.tabBarLabel, { color: col, fontWeight: isCurrent ? "600" : "400" }]}>
                {tab.title}
              </RNText>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screenWrap: { flex: 1 },
  navBar: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navLeft: { flexDirection: "row", alignItems: "center", minWidth: 64, zIndex: 2 },
  navCenter: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  navRight: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", minWidth: 64, zIndex: 2 },
  toolbarSlotRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolbarItem: { flexDirection: "row", alignItems: "center" },
  principalWrap: { alignItems: "center", justifyContent: "center" },
  navTitle: { fontSize: 17, fontWeight: "700" },
  backBtn: { flexDirection: "row", alignItems: "center", paddingRight: 8, paddingVertical: 4 },
  backText: { fontSize: 15, fontWeight: "500", marginLeft: 2 },
  screenBody: { flex: 1 },
  stackRoot: { flex: 1, position: "relative" },
  stackLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  tabViewRoot: { flex: 1 },
  tabViewStage: { flex: 1, position: "relative" },
  tabPane: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  tabContent: { flex: 1 },
  bottomAccessoryWrap: {
    paddingHorizontal: 12,
    paddingBottom: 6,
    paddingTop: 4,
    alignItems: "center",
  },
  tabBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 4,
  },
  tabBarItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 4,
  },
  tabBarLabel: { fontSize: 11 },
})
