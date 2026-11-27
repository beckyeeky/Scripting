import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import { NativeModules, StatusBar, useColorScheme } from "react-native"
import { loadSettings, onSettingsChanged, type AppSettings } from "../../../../../Pix-Scripting/src/store/settings"
import { ThemeContext as ScriptingThemeContext } from "../../scripting/theme"
import { buildAppTheme, type AppTheme } from "./colors"
import { InsetsProvider } from "./insets"

const { PixSystemBridge } = NativeModules

const AppThemeContext = createContext<AppTheme | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const rnScheme = useColorScheme() === "dark" ? "dark" : "light"
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  useEffect(() => {
    setSettings(loadSettings())
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  const theme = useMemo(() => buildAppTheme(settings, rnScheme), [settings, rnScheme])

  useEffect(() => {
    try {
      PixSystemBridge?.setSystemBarStyle?.(theme.isDark)
    } catch {
      // Ignore on non-Android environments
    }
  }, [theme.isDark])

  const scriptingThemeValue = useMemo(
    () => ({ isDark: theme.isDark, tint: theme.accent, colors: {} }),
    [theme.isDark, theme.accent],
  )

  return (
    <AppThemeContext.Provider value={theme}>
      <ScriptingThemeContext.Provider value={scriptingThemeValue}>
        <InsetsProvider>
          <StatusBar
            translucent={true}
            backgroundColor="transparent"
            barStyle={theme.isDark ? "light-content" : "dark-content"}
          />
          {children}
        </InsetsProvider>
      </ScriptingThemeContext.Provider>
    </AppThemeContext.Provider>
  )
}

export function useAppTheme(): AppTheme {
  const ctx = useContext(AppThemeContext)
  if (!ctx) {
    return buildAppTheme(loadSettings(), "light")
  }
  return ctx
}
