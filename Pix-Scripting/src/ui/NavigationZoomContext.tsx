import {
  createContext,
  useContext,
  useEffect,
  useState,
  NamespaceReader,
} from "scripting"
import { loadSettings, onSettingsChanged } from "../store/settings"
import { useDualRoute } from "./DualRouteContext"

export interface NavigationZoomContextValue {
  namespace: NamespaceID | null
  isZoomEnabled: boolean
  getSource: (
    id: string | number
  ) => { id: string | number; namespace: NamespaceID } | undefined
}

const NavigationZoomContext = createContext<NavigationZoomContextValue | null>()

let activeGlobalNamespace: NamespaceID | null = null
let isGlobalZoomActive = false

export function getActiveZoomNamespace(): NamespaceID | null {
  return isGlobalZoomActive ? activeGlobalNamespace : null
}

export function useNavigationZoom(): NavigationZoomContextValue {
  const ctx = useContext(NavigationZoomContext)
  if (ctx) return ctx
  return {
    namespace: null,
    isZoomEnabled: false,
    getSource: () => undefined,
  }
}

export function NavigationZoomProvider(props: { children: any }) {
  const [settings, setSettings] = useState(() => loadSettings())
  const { isSplitViewActive } = useDualRoute()

  useEffect(() => {
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  // 仅在单栏模式（iPhone 全局、iPad 单栏紧凑态）且用户开启了缩放展开时生效
  const isZoomEnabled = !isSplitViewActive && settings.navigationTransition === "zoom"

  return (
    <NamespaceReader>
      {(namespace) => {
        activeGlobalNamespace = namespace
        isGlobalZoomActive = isZoomEnabled

        const value: NavigationZoomContextValue = {
          namespace: isZoomEnabled ? namespace : null,
          isZoomEnabled,
          getSource: (id) =>
            isZoomEnabled ? { id: String(id), namespace } : undefined,
        }

        return (
          <NavigationZoomContext.Provider value={value}>
            {props.children}
          </NavigationZoomContext.Provider>
        )
      }}
    </NamespaceReader>
  )
}
