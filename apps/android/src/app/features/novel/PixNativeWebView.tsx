import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import {
  findNodeHandle,
  requireNativeComponent,
  StyleSheet,
  UIManager,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

const HAS_NATIVE_WEBVIEW = Boolean(UIManager.getViewManagerConfig?.("PixWebView"))
const NativePixWebView: any = HAS_NATIVE_WEBVIEW
  ? requireNativeComponent("PixWebView")
  : null

const COMMAND_EVALUATE_JS_ID = 1

export interface PixNativeWebViewHandle {
  loadHTML: (html: string, generation?: number) => Promise<boolean>
  evaluateJavaScript: (script: string) => Promise<string | null>
}

export interface PixNativeWebViewProps {
  initialHtml?: string | null
  htmlGeneration?: number
  style?: StyleProp<ViewStyle>
  onScriptMessage?: (name: string, payload: any, generation: number) => void
  onLoadComplete?: (generation: number, success: boolean, crashed?: boolean) => void
}

export const PixNativeWebView = forwardRef<PixNativeWebViewHandle, PixNativeWebViewProps>(
  function PixNativeWebView(
    { initialHtml, htmlGeneration = 1, style, onScriptMessage, onLoadComplete },
    ref,
  ) {
    const nativeRef = useRef<any>(null)
    const [htmlPayload, setHtmlPayload] = useState<{ html: string; generation: number } | null>(
      initialHtml ? { html: initialHtml, generation: htmlGeneration } : null,
    )
    const [fallbackEvalQueue, setFallbackEvalQueue] = useState<
      Array<{ id: number; script: string }>
    >([])

    const evalSeqRef = useRef(1)
    const loadGenRef = useRef(htmlGeneration)
    const pendingLoadResolvers = useRef(new Map<number, (ok: boolean) => void>())
    const pendingEvalResolvers = useRef(new Map<number, (res: string | null) => void>())

    useEffect(() => {
      if (initialHtml != null) {
        loadGenRef.current = htmlGeneration
        setHtmlPayload({ html: initialHtml, generation: htmlGeneration })
      }
    }, [initialHtml, htmlGeneration])

    useEffect(() => {
      return () => {
        pendingLoadResolvers.current.forEach((resolve) => resolve(false))
        pendingLoadResolvers.current.clear()
        pendingEvalResolvers.current.forEach((resolve) => resolve(null))
        pendingEvalResolvers.current.clear()
      }
    }, [])

    const loadHTML = useCallback((html: string, explicitGeneration?: number): Promise<boolean> => {
      const gen = explicitGeneration ?? ++loadGenRef.current
      loadGenRef.current = gen
      return new Promise<boolean>((resolve) => {
        pendingLoadResolvers.current.set(gen, resolve)
        setHtmlPayload({ html, generation: gen })
        setTimeout(() => {
          const pending = pendingLoadResolvers.current.get(gen)
          if (pending) {
            pendingLoadResolvers.current.delete(gen)
            pending(true)
          }
        }, 5000)
      })
    }, [])

    const evaluateJavaScript = useCallback((script: string): Promise<string | null> => {
      if (!script) return Promise.resolve(null)
      const evalId = evalSeqRef.current++
      return new Promise<string | null>((resolve) => {
        pendingEvalResolvers.current.set(evalId, resolve)
        const timer = setTimeout(() => {
          const pending = pendingEvalResolvers.current.get(evalId)
          if (pending) {
            pendingEvalResolvers.current.delete(evalId)
            pending(null)
          }
        }, 4000)

        const wrappedResolve = (res: string | null) => {
          clearTimeout(timer)
          resolve(res)
        }
        pendingEvalResolvers.current.set(evalId, wrappedResolve)

        const nodeHandle = nativeRef.current ? findNodeHandle(nativeRef.current) : null
        if (nodeHandle != null && typeof UIManager.dispatchViewManagerCommand === "function") {
          try {
            const cmd =
              UIManager.getViewManagerConfig?.("PixWebView")?.Commands?.evaluateJS ??
              COMMAND_EVALUATE_JS_ID
            UIManager.dispatchViewManagerCommand(nodeHandle, cmd, [evalId, script])
            return
          } catch {
            // Fall through to prop queue if direct command fails
          }
        }
        setFallbackEvalQueue((prev) => [...prev.slice(-48), { id: evalId, script }])
      })
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        loadHTML,
        evaluateJavaScript,
      }),
      [loadHTML, evaluateJavaScript],
    )

    if (!NativePixWebView) {
      return <View style={[styles.fallback, style]} />
    }

    return (
      <NativePixWebView
        ref={nativeRef}
        htmlPayload={htmlPayload}
        evalQueue={fallbackEvalQueue}
        onScriptMessage={(e: any) => {
          const evt = e?.nativeEvent
          if (!evt?.name || !onScriptMessage) return
          let parsed: any = evt.payload
          if (typeof evt.payload === "string") {
            try {
              parsed = JSON.parse(evt.payload)
            } catch {
              parsed = evt.payload
            }
          }
          onScriptMessage(evt.name, parsed, Number(evt.generation) || 0)
        }}
        onLoadComplete={(e: any) => {
          const evt = e?.nativeEvent || {}
          const gen = Number(evt.generation) || 0
          const success = Boolean(evt.success)
          const crashed = Boolean(evt.crashed)
          const pending = pendingLoadResolvers.current.get(gen)
          if (pending) {
            pendingLoadResolvers.current.delete(gen)
            pending(success)
          }
          onLoadComplete?.(gen, success, crashed)
        }}
        onEvalResult={(e: any) => {
          const evt = e?.nativeEvent || {}
          const evalId = Number(evt.evalId) || 0
          const pending = pendingEvalResolvers.current.get(evalId)
          if (pending) {
            pendingEvalResolvers.current.delete(evalId)
            pending(evt.result != null ? String(evt.result) : null)
          }
        }}
        style={[styles.webview, style]}
      />
    )
  },
)

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  fallback: {
    flex: 1,
  },
})
