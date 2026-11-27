import type React from "react"

export interface SheetOptions {
  id?: string
  title?: string
  fullHeight?: boolean
  hideHeader?: boolean
  render: (close: () => void) => React.ReactNode
}

export interface SheetEntry {
  id: string
  title?: string
  fullHeight?: boolean
  hideHeader?: boolean
  render: (close: () => void) => React.ReactNode
}

export interface ActionSheetAction {
  label: string
  destructive?: boolean
  checked?: boolean
  disabled?: boolean
  onPress?: () => void
}

export interface ActionSheetOptions {
  title?: string
  message?: string
  actions: ActionSheetAction[]
}

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

export type ToastTone = "info" | "success" | "error"

export interface BlockWorkTarget {
  user?: {
    id: number
    name: string
    account?: string
    avatarURL?: string
  } | null
  tags?: string[]
}

export interface IosImportSheetOptions {
  initialJsonText?: string | null
  initialZipPath?: string | null
  onImported?: (message: string, authChanged: boolean) => void
}

export interface OverlayAPI {
  presentSheet: (opts: SheetOptions) => string
  dismissSheet: (id?: string) => void
  presentActionSheet: (opts: ActionSheetOptions) => Promise<number | null>
  alert: (title: string, message?: string) => Promise<void>
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  prompt: (opts: PromptOptions) => Promise<string | null>
  showToast: (message: string, tone?: ToastTone) => void
  openBookmarkDetail: (type: "illust" | "novel", id: number) => void
  openComments: (type: "illust" | "novel", id: number) => void
  openBlockWork: (opts: BlockWorkTarget) => void
  openIosImport: (opts?: IosImportSheetOptions) => void
  dismissTopOverlay: () => boolean
}
