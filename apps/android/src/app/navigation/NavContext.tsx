import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { BackHandler } from "react-native"
import { seedIllustFromPixivCache } from "../../../../../Pix-Scripting/src/image/imageLoader"
import {
  registerTabNavigator,
  setActiveTabKind,
  setPixivRouteNavigator,
  type PixivTabKind,
} from "../../../../../Pix-Scripting/src/store/routeNavigation"
import { loadSettings } from "../../../../../Pix-Scripting/src/store/settings"
import {
  seedIllustFromWidgetPool,
  seedPixivisionFromWidgetPool,
} from "../../../../../Pix-Scripting/src/store/widgetStore"
import { parseRouteString, routeSignature } from "./routeParser"
import type { AppNavAPI, Route, StackEntry, TabId } from "./types"

export interface BackActionState {
  activeTab: TabId
  launchTab: TabId
  stacks: Record<TabId, StackEntry[]>
}

export type BackActionResult =
  | { handled: true; reason: "overlay" }
  | { handled: true; reason: "pop"; tab: TabId; nextStacks: Record<TabId, StackEntry[]> }
  | { handled: true; reason: "switchTab"; nextTab: TabId }
  | { handled: false; reason: "exit" }

/**
 * Deterministic Android hardware back priority:
 * 1. Dismiss top overlay/sheet/dialog if any is open.
 * 2. Pop active tab's stack ONLY (never touch inactive tabs' stacks).
 * 3. Switch back to launch tab if on a different tab root.
 * 4. Allow Android to exit/minimize.
 */
export function reduceBackAction(
  state: BackActionState,
  dismissTopOverlay: () => boolean,
): BackActionResult {
  if (dismissTopOverlay()) {
    return { handled: true, reason: "overlay" }
  }
  const activeStack = state.stacks[state.activeTab]
  if (activeStack && activeStack.length > 0) {
    return {
      handled: true,
      reason: "pop",
      tab: state.activeTab,
      nextStacks: {
        ...state.stacks,
        [state.activeTab]: activeStack.slice(0, -1),
      },
    }
  }
  if (state.activeTab !== state.launchTab) {
    return { handled: true, reason: "switchTab", nextTab: state.launchTab }
  }
  return { handled: false, reason: "exit" }
}

function emptyStacks(): Record<TabId, StackEntry[]> {
  return {
    discovery: [],
    ranking: [],
    following: [],
    more: [],
    search: [],
  }
}

function resolveLaunchTab(): TabId {
  try {
    const lp = loadSettings().launchPage
    if (lp === "ranking" || lp === "following" || lp === "discovery") {
      return lp
    }
  } catch {}
  return "discovery"
}

function seedRouteCaches(route: Route): void {
  try {
    if (route.name === "illust") {
      seedIllustFromWidgetPool(route.id)
      seedIllustFromPixivCache(route.id)
    } else if (route.name === "pixivision") {
      seedPixivisionFromWidgetPool(route.id)
    }
  } catch {
    // Cache seeding is best-effort
  }
}

const NavContext = createContext<AppNavAPI | null>(null)

export function NavProvider({
  children,
  dismissTopOverlay,
  isLoggedIn,
}: {
  children: React.ReactNode
  dismissTopOverlay: () => boolean
  isLoggedIn: boolean
}) {
  const launchTab = useRef<TabId>(resolveLaunchTab()).current
  const [activeTab, setActiveTab] = useState<TabId>(launchTab)
  const [stacks, setStacks] = useState<Record<TabId, StackEntry[]>>(emptyStacks)
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set([launchTab]))
  const seqRef = useRef(1)

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const stacksRef = useRef(stacks)
  stacksRef.current = stacks
  const dismissOverlayRef = useRef(dismissTopOverlay)
  dismissOverlayRef.current = dismissTopOverlay
  const loggedInRef = useRef(isLoggedIn)
  loggedInRef.current = isLoggedIn

  useEffect(() => {
    setActiveTabKind(activeTab as PixivTabKind)
  }, [activeTab])

  const selectTab = useCallback((tab: TabId) => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
    setActiveTab((prev) => {
      if (prev === tab) {
        // Re-tapping active tab pops its stack to root
        setStacks((curr) => (curr[tab].length > 0 ? { ...curr, [tab]: [] } : curr))
        return prev
      }
      return tab
    })
  }, [])

  const push = useCallback((route: Route, explicitTab?: TabId) => {
    seedRouteCaches(route)
    const targetTab = explicitTab ?? activeTabRef.current
    if (explicitTab && explicitTab !== activeTabRef.current) {
      setVisitedTabs((prev) => {
        if (prev.has(explicitTab)) return prev
        const next = new Set(prev)
        next.add(explicitTab)
        return next
      })
      setActiveTab(explicitTab)
    }
    const sig = routeSignature(route)
    setStacks((prev) => {
      const list = prev[targetTab]
      if (list.length > 0 && routeSignature(list[list.length - 1].route) === sig) {
        return prev
      }
      const entry: StackEntry = { key: `${sig}#${seqRef.current++}`, route }
      return { ...prev, [targetTab]: [...list, entry] }
    })
  }, [])

  const replace = useCallback((route: Route, explicitTab?: TabId) => {
    seedRouteCaches(route)
    const targetTab = explicitTab ?? activeTabRef.current
    const sig = routeSignature(route)
    setStacks((prev) => {
      const list = prev[targetTab]
      const entry: StackEntry = { key: `${sig}#${seqRef.current++}`, route }
      if (list.length === 0) {
        return { ...prev, [targetTab]: [entry] }
      }
      return { ...prev, [targetTab]: [...list.slice(0, -1), entry] }
    })
  }, [])

  const pop = useCallback((count = 1, explicitTab?: TabId) => {
    const targetTab = explicitTab ?? activeTabRef.current
    setStacks((prev) => {
      const list = prev[targetTab]
      if (list.length === 0) return prev
      const nextLen = Math.max(0, list.length - Math.max(1, count))
      return { ...prev, [targetTab]: list.slice(0, nextLen) }
    })
  }, [])

  const popToRoot = useCallback((explicitTab?: TabId) => {
    const targetTab = explicitTab ?? activeTabRef.current
    setStacks((prev) => (prev[targetTab].length > 0 ? { ...prev, [targetTab]: [] } : prev))
  }, [])

  const pushRouteString = useCallback(
    (rawRoute: string, explicitTab?: TabId) => {
      const parsed = parseRouteString(rawRoute)
      push(parsed, explicitTab)
    },
    [push],
  )

  // Reset stacks when logging out so next account starts clean
  useEffect(() => {
    if (!isLoggedIn) {
      setStacks(emptyStacks())
      setActiveTab(launchTab)
      setVisitedTabs(new Set([launchTab]))
    }
  }, [isLoggedIn, launchTab])

  // Bridge Pix-Scripting/src/store/routeNavigation.ts into Android-native NavContext
  useEffect(() => {
    if (!isLoggedIn) return
    const unsubs = [
      registerTabNavigator("discovery", (r) => pushRouteString(r, "discovery")),
      registerTabNavigator("ranking", (r) => pushRouteString(r, "ranking")),
      registerTabNavigator("following", (r) => pushRouteString(r, "following")),
      registerTabNavigator("more", (r) => pushRouteString(r, "more")),
      registerTabNavigator("search", (r) => pushRouteString(r, "search")),
      setPixivRouteNavigator((r) => pushRouteString(r)),
    ]
    return () => {
      unsubs.forEach((fn) => fn())
    }
  }, [isLoggedIn, pushRouteString])

  // Single root Android hardware BackHandler
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!loggedInRef.current) {
        return dismissOverlayRef.current()
      }
      const outcome = reduceBackAction(
        {
          activeTab: activeTabRef.current,
          launchTab,
          stacks: stacksRef.current,
        },
        () => dismissOverlayRef.current(),
      )
      if (!outcome.handled) return false
      if (outcome.reason === "pop") {
        setStacks(outcome.nextStacks)
      } else if (outcome.reason === "switchTab") {
        setActiveTab(outcome.nextTab)
      }
      return true
    })
    return () => sub.remove()
  }, [launchTab])

  const canGoBack = stacks[activeTab].length > 0

  const value = useMemo<AppNavAPI>(
    () => ({
      activeTab,
      stacks,
      visitedTabs,
      canGoBack,
      selectTab,
      push,
      replace,
      pop,
      popToRoot,
      pushRouteString,
    }),
    [activeTab, stacks, visitedTabs, canGoBack, selectTab, push, replace, pop, popToRoot, pushRouteString],
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useAppNav(): AppNavAPI {
  const ctx = useContext(NavContext)
  if (!ctx) {
    throw new Error("useAppNav must be used inside NavProvider")
  }
  return ctx
}
