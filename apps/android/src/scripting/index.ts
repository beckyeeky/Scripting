import "./polyfills"
import { installHostGlobals } from "./hostGlobals"

installHostGlobals()

import React from "react"

export function createContext<T>(defaultValue?: T): React.Context<T> {
  return React.createContext<T>(defaultValue as T)
}

export {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

export {
  PolyfillAbortController as AbortController,
  PolyfillURL as URL,
  PolyfillURLSearchParams as URLSearchParams,
} from "./polyfills"

export {
  scriptingFetch as fetch,
  ScriptingResponse as Response,
  ScriptingFormData as FormData,
} from "./fetchAndHttp"

export {
  ScriptingAppEvents as AppEvents,
  ScriptingDevice as Device,
  ScriptingScript as Script,
  ScriptingNotification as Notification,
  ScriptingLiveActivity as LiveActivity,
  ScriptingWidget as Widget,
  ScriptingImageRenderer as ImageRenderer,
  ScriptingDialog as Dialog,
  ScriptingFileManager as FileManager,
  ScriptingKeychain as Keychain,
  ScriptingStorage as Storage,
  ScriptingPasteboard as Pasteboard,
  ScriptingDocumentPicker as DocumentPicker,
  ScriptingShareSheet as ShareSheet,
  ScriptingSafari as Safari,
  ScriptingPhotos as Photos,
  ScriptingHapticFeedback as HapticFeedback,
  ScriptingWebViewController as WebViewController,
  ScriptingUIGlass as UIGlass,
  ScriptingAnimation as Animation,
  ScriptingTransition as Transition,
  scriptingWithAnimation as withAnimation,
} from "./hostGlobals"

export {
  useObservable,
  NavigationStack,
  NavigationLink,
  NavigationDestination,
  Navigation,
  TabView,
  Tab,
  type Observable,
} from "./navigation"

export {
  Button,
  Canvas,
  Capsule,
  Circle,
  ColorPicker,
  DatePicker,
  DisclosureGroup,
  Divider,
  DragGesture,
  Ellipse,
  FlowLayout,
  GeometryReader,
  GlassEffectContainer,
  Group,
  HStack,
  Image,
  Label,
  LazyVGrid,
  LazyVStack,
  Link,
  List,
  LongPressGesture,
  MagnifyGesture,
  Markdown,
  Menu,
  NamespaceReader,
  Picker,
  ProgressView,
  Rectangle,
  RoundedRectangle,
  ScrollView,
  ScrollViewProxy,
  ScrollViewReader,
  Section,
  SecureField,
  Shape,
  Slider,
  Spacer,
  TapGesture,
  Text,
  TextField,
  TimelineCanvas,
  Toggle,
  VStack,
  WebView,
  ZStack,
  useColorScheme,
} from "./components"

export {
  type Color,
  type PresentationDetent,
  type ScenePhase,
  type StyledText,
} from "./theme"

export { type CommonViewProps, type VirtualNode } from "./modifiers"

export type LiveActivity<T = any> = any

export const AppIntentProtocol = {
  AppIntent: "AppIntent",
  LiveActivityIntent: "LiveActivityIntent",
} as const
export type AppIntentProtocol = (typeof AppIntentProtocol)[keyof typeof AppIntentProtocol]

export const AppIntentManager = {
  register: (_def?: any): ((...args: any[]) => any) => () => ({}),
}
export type KeywordPoint = { x: number; y: number; keyword: string }
export const LiveActivityUI = (_props: any) => null
export type LiveActivityUIBuilder<T = any> = (state: T) => any
export const LiveActivityUIExpandedBottom = (_props: any) => null
export const LiveActivityUIExpandedLeading = (_props: any) => null
export const LiveActivityUIExpandedTrailing = (_props: any) => null
export const apiKey = ""
export const model = ""
export const session = null
