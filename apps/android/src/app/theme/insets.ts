import React, { createContext, useContext, useEffect, useState } from "react"
import {
  DeviceEventEmitter,
  Keyboard,
  NativeModules,
  Platform,
  StatusBar,
} from "react-native"

export interface EdgeInsets {
  top: number
  bottom: number
  left: number
  right: number
  imeBottom: number
}

const { PixSystemBridge } = NativeModules

function sanitizeInset(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : Number(value)
  return Number.isFinite(num) && num >= 0 ? num : fallback
}

export function getInitialInsets(): EdgeInsets {
  const fallbackTop = Platform.OS === "android" ? sanitizeInset(StatusBar.currentHeight, 24) : 0
  try {
    const raw = PixSystemBridge?.getWindowInsetsSync?.()
    if (raw && typeof raw === "object") {
      return {
        top: sanitizeInset(raw.top, fallbackTop),
        bottom: sanitizeInset(raw.bottom, 0),
        left: sanitizeInset(raw.left, 0),
        right: sanitizeInset(raw.right, 0),
        imeBottom: sanitizeInset(raw.imeBottom, 0),
      }
    }
  } catch {
    // Fallback to StatusBar height when native sync bridge is unavailable
  }
  return {
    top: fallbackTop,
    bottom: 0,
    left: 0,
    right: 0,
    imeBottom: 0,
  }
}

const DEFAULT_INSETS: EdgeInsets = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  imeBottom: 0,
}

const InsetsContext = createContext<EdgeInsets>(DEFAULT_INSETS)

export function InsetsProvider({ children }: { children: React.ReactNode }) {
  const [insets, setInsets] = useState<EdgeInsets>(() => getInitialInsets())

  useEffect(() => {
    setInsets(getInitialInsets())

    let receivedNativeIme = false
    const nativeSub = DeviceEventEmitter.addListener("PixInsetsChanged", (payload: any) => {
      if (!payload || typeof payload !== "object") return
      if (typeof payload.imeBottom === "number") {
        receivedNativeIme = true
      }
      setInsets((prev) => {
        const next: EdgeInsets = {
          top: sanitizeInset(payload.top, prev.top),
          bottom: sanitizeInset(payload.bottom, prev.bottom),
          left: sanitizeInset(payload.left, prev.left),
          right: sanitizeInset(payload.right, prev.right),
          imeBottom: sanitizeInset(payload.imeBottom, prev.imeBottom),
        }
        if (
          next.top === prev.top &&
          next.bottom === prev.bottom &&
          next.left === prev.left &&
          next.right === prev.right &&
          next.imeBottom === prev.imeBottom
        ) {
          return prev
        }
        return next
      })
    })

    // Safety fallback if keyboard events fire before/without native imeBottom
    const kbShowSub = Keyboard.addListener("keyboardDidShow", (evt) => {
      if (receivedNativeIme) return
      const height = sanitizeInset(evt?.endCoordinates?.height, 0)
      if (height <= 0) return
      setInsets((prev) => {
        const nextIme = Math.max(0, height - prev.bottom)
        return prev.imeBottom === nextIme ? prev : { ...prev, imeBottom: nextIme }
      })
    })
    const kbHideSub = Keyboard.addListener("keyboardDidHide", () => {
      if (receivedNativeIme) return
      setInsets((prev) => (prev.imeBottom === 0 ? prev : { ...prev, imeBottom: 0 }))
    })

    return () => {
      nativeSub.remove()
      kbShowSub.remove()
      kbHideSub.remove()
    }
  }, [])

  return React.createElement(InsetsContext.Provider, { value: insets }, children)
}

export function useSafeInsets(): EdgeInsets {
  return useContext(InsetsContext)
}

/**
 * Total bottom inset clearing both the system navigation bar and any open IME.
 * Native `imeBottom` (and the JS Keyboard fallback) represent extra keyboard
 * height above `insets.bottom`, so the two must be added rather than max'd.
 */
export function effectiveBottomInset(insets: Pick<EdgeInsets, "bottom" | "imeBottom">): number {
  return Math.max(0, insets.bottom) + Math.max(0, insets.imeBottom)
}
