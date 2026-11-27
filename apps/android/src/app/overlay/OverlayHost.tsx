import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { onOpenBookmarkDetail } from "../../../../../Pix-Scripting/src/store/bookmarkSync"
import { IosConfigImportContent } from "../../import/IosConfigImportModal"
import {
  ScriptingDialog,
  subscribeDialog,
  type DialogRequest,
} from "../../scripting/hostGlobals"
import { effectiveBottomInset, useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"
import { BlockWorkSheet } from "./BlockWorkSheet"
import { BookmarkDetailSheet } from "./BookmarkDetailSheet"
import { CommentsSheet } from "./CommentsSheet"
import type {
  ActionSheetOptions,
  BlockWorkTarget,
  ConfirmOptions,
  IosImportSheetOptions,
  OverlayAPI,
  PromptOptions,
  SheetEntry,
  SheetOptions,
  ToastTone,
} from "./types"

interface ActiveActionSheet {
  options: ActionSheetOptions
  resolve: (index: number | null) => void
}

interface ToastState {
  id: number
  message: string
  tone: ToastTone
}

/**
 * Pure helper for unit testing unified overlay dismissal order:
 * Dialog -> ActionSheet -> Top Sheet -> none.
 */
export function resolveTopOverlayDismissTarget(state: {
  hasDialog: boolean
  hasActionSheet: boolean
  sheetCount: number
}): "dialog" | "actionSheet" | "sheet" | "none" {
  if (state.hasDialog) return "dialog"
  if (state.hasActionSheet) return "actionSheet"
  if (state.sheetCount > 0) return "sheet"
  return "none"
}

const OverlayContext = createContext<OverlayAPI | null>(null)

export function OverlayProvider({
  children,
  registerDismissHandler,
}: {
  children: React.ReactNode
  registerDismissHandler?: (handler: () => boolean) => void
}) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()

  const [sheets, setSheets] = useState<SheetEntry[]>([])
  const [actionSheet, setActionSheet] = useState<ActiveActionSheet | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [promptValue, setPromptValue] = useState("")
  const [toast, setToast] = useState<ToastState | null>(null)

  const sheetSeqRef = useRef(1)
  const toastSeqRef = useRef(1)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sheetsRef = useRef(sheets)
  sheetsRef.current = sheets
  const actionSheetRef = useRef(actionSheet)
  actionSheetRef.current = actionSheet
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog

  // Bridge global ScriptingDialog (used by Pix-Scripting/src/downloader/*) into this single host
  useEffect(() => {
    return subscribeDialog((req) => {
      setDialog(req)
      if (req?.kind === "prompt") {
        setPromptValue(req.defaultValue ?? "")
      }
    })
  }, [])

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    if (!message) return
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    const id = toastSeqRef.current++
    setToast({ id, message, tone })
    toastTimerRef.current = setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr))
    }, 2400)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const presentSheet = useCallback((opts: SheetOptions): string => {
    const id = opts.id || `sheet-${sheetSeqRef.current++}`
    setSheets((prev) => {
      const filtered = prev.filter((item) => item.id !== id)
      return [
        ...filtered,
        {
          id,
          title: opts.title,
          fullHeight: opts.fullHeight,
          hideHeader: opts.hideHeader,
          render: opts.render,
        },
      ]
    })
    return id
  }, [])

  const dismissSheet = useCallback((id?: string) => {
    setSheets((prev) => {
      if (prev.length === 0) return prev
      if (!id) return prev.slice(0, -1)
      return prev.filter((item) => item.id !== id)
    })
  }, [])

  const presentActionSheet = useCallback((options: ActionSheetOptions): Promise<number | null> => {
    return new Promise((resolve) => {
      // Cancel any previous action sheet cleanly
      if (actionSheetRef.current) {
        actionSheetRef.current.resolve(null)
      }
      setActionSheet({ options, resolve })
    })
  }, [])

  const closeActionSheet = useCallback((index: number | null) => {
    const active = actionSheetRef.current
    if (!active) return
    setActionSheet(null)
    active.resolve(index)
    if (index != null) {
      const chosen = active.options.actions[index]
      if (chosen && !chosen.disabled && chosen.onPress) {
        setTimeout(() => chosen.onPress?.(), 10)
      }
    }
  }, [])

  const closeDialogWithCancel = useCallback(() => {
    const active = dialogRef.current
    if (!active) return
    if (active.kind === "alert") active.resolve()
    else if (active.kind === "confirm") active.resolve(false)
    else if (active.kind === "actionSheet") active.resolve(null)
    else if (active.kind === "prompt") active.resolve(null)
  }, [])

  const dismissTopOverlay = useCallback((): boolean => {
    const target = resolveTopOverlayDismissTarget({
      hasDialog: Boolean(dialogRef.current),
      hasActionSheet: Boolean(actionSheetRef.current),
      sheetCount: sheetsRef.current.length,
    })
    if (target === "dialog") {
      closeDialogWithCancel()
      return true
    }
    if (target === "actionSheet") {
      closeActionSheet(null)
      return true
    }
    if (target === "sheet") {
      dismissSheet()
      return true
    }
    return false
  }, [closeDialogWithCancel, closeActionSheet, dismissSheet])

  useEffect(() => {
    registerDismissHandler?.(dismissTopOverlay)
  }, [registerDismissHandler, dismissTopOverlay])

  const alert = useCallback((title: string, message?: string) => {
    return ScriptingDialog.alert({ title, message })
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    return ScriptingDialog.confirm({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
    })
  }, [])

  const prompt = useCallback((opts: PromptOptions) => {
    return ScriptingDialog.prompt({
      title: opts.title,
      message: opts.message,
      defaultValue: opts.defaultValue,
      placeholder: opts.placeholder,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
    })
  }, [])

  const openBookmarkDetail = useCallback(
    (type: "illust" | "novel", id: number) => {
      presentSheet({
        id: `bookmark-${type}-${id}`,
        title: "收藏设置",
        render: (close) => (
          <BookmarkDetailSheet type={type} id={id} onClose={close} onToast={showToast} />
        ),
      })
    },
    [presentSheet, showToast],
  )

  const openComments = useCallback(
    (type: "illust" | "novel", id: number) => {
      presentSheet({
        id: `comments-${type}-${id}`,
        title: "评论",
        fullHeight: true,
        render: (close) => (
          <CommentsSheet type={type} id={id} onClose={close} onToast={showToast} />
        ),
      })
    },
    [presentSheet, showToast],
  )

  const openBlockWork = useCallback(
    (opts: BlockWorkTarget) => {
      presentSheet({
        id: "block-work",
        title: "屏蔽管理",
        render: () => <BlockWorkSheet target={opts} onToast={showToast} />,
      })
    },
    [presentSheet, showToast],
  )

  const openIosImport = useCallback(
    (opts?: IosImportSheetOptions) => {
      presentSheet({
        id: "ios-config-import",
        title: "导入 iOS 配置 / Token",
        fullHeight: true,
        render: (close) => (
          <IosConfigImportContent
            initialJsonText={opts?.initialJsonText}
            initialZipPath={opts?.initialZipPath}
            onClose={close}
            onImported={opts?.onImported}
          />
        ),
      })
    },
    [presentSheet],
  )

  // Bridge Pix-Scripting bookmark detail open events
  useEffect(() => {
    return onOpenBookmarkDetail((type, id) => {
      openBookmarkDetail(type, id)
    })
  }, [openBookmarkDetail])

  const api = useMemo<OverlayAPI>(
    () => ({
      presentSheet,
      dismissSheet,
      presentActionSheet,
      alert,
      confirm,
      prompt,
      showToast,
      openBookmarkDetail,
      openComments,
      openBlockWork,
      openIosImport,
      dismissTopOverlay,
    }),
    [
      presentSheet,
      dismissSheet,
      presentActionSheet,
      alert,
      confirm,
      prompt,
      showToast,
      openBookmarkDetail,
      openComments,
      openBlockWork,
      openIosImport,
      dismissTopOverlay,
    ],
  )

  return (
    <OverlayContext.Provider value={api}>
      {children}

      {/* Unified Root Overlay Portal — ZERO RN Modal windows */}
      {sheets.map((entry, idx) => {
        const isTop = idx === sheets.length - 1
        return (
          <View
            key={entry.id}
            style={[
              styles.portalLayer,
              {
                backgroundColor: isTop ? colors.backdrop : "transparent",
                zIndex: 100 + idx,
              },
            ]}
            pointerEvents={isTop ? "auto" : "none"}
          >
            <Pressable
              style={{ height: entry.fullHeight ? insets.top + 20 : insets.top + 88 }}
              onPress={() => dismissSheet(entry.id)}
            />
            <View
              style={[
                styles.sheetCard,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.glassBorder,
                  flex: entry.fullHeight ? 1 : undefined,
                  maxHeight: entry.fullHeight ? undefined : "84%",
                },
              ]}
            >
              {!entry.hideHeader ? (
                <View
                  style={[
                    styles.sheetHeader,
                    {
                      backgroundColor: colors.surface,
                      borderBottomColor: colors.separator,
                    },
                  ]}
                >
                  <View style={[styles.dragHandle, { backgroundColor: colors.fillStrong }]} />
                  <View style={styles.sheetHeaderRow}>
                    <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                      {entry.title || ""}
                    </Text>
                    <Pressable onPress={() => dismissSheet(entry.id)} hitSlop={10}>
                      <Text style={[styles.sheetClose, { color: accent }]}>完成</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              <View style={entry.fullHeight ? styles.sheetBodyFlex : styles.sheetBodyAuto}>
                {entry.render(() => dismissSheet(entry.id))}
              </View>
            </View>
          </View>
        )
      })}

      {actionSheet ? (
        <View style={[styles.portalLayer, { backgroundColor: colors.backdrop, zIndex: 400 }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => closeActionSheet(null)} />
          <View
            style={[
              styles.actionSheetWrap,
              { paddingBottom: Math.max(insets.bottom, 12) + 8 },
            ]}
          >
            <View
              style={[
                styles.actionCard,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              {actionSheet.options.title || actionSheet.options.message ? (
                <View style={[styles.actionHeader, { borderBottomColor: colors.separator }]}>
                  {actionSheet.options.title ? (
                    <Text style={[styles.actionTitle, { color: colors.text }]}>
                      {actionSheet.options.title}
                    </Text>
                  ) : null}
                  {actionSheet.options.message ? (
                    <Text style={[styles.actionMsg, { color: colors.textSecondary }]}>
                      {actionSheet.options.message}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <ScrollView style={{ maxHeight: 380 }}>
                {actionSheet.options.actions.map((act, idx) => (
                  <Pressable
                    key={`act-${idx}`}
                    disabled={act.disabled}
                    onPress={() => closeActionSheet(idx)}
                    style={({ pressed }) => [
                      styles.actionRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.separator,
                      },
                      act.disabled && { opacity: 0.4 },
                      pressed && { backgroundColor: colors.fill },
                    ]}
                  >
                    <Text
                      style={[
                        styles.actionRowText,
                        { color: act.destructive ? colors.danger : accent },
                      ]}
                    >
                      {act.checked ? "✓ " : ""}
                      {act.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <Pressable
              onPress={() => closeActionSheet(null)}
              style={({ pressed }) => [
                styles.cancelCard,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.cancelText, { color: accent }]}>取消</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {dialog ? (
        <View
          style={[
            styles.dialogBackdrop,
            {
              backgroundColor: colors.backdrop,
              paddingBottom: effectiveBottomInset(insets) + 24,
              zIndex: 500,
            },
          ]}
        >
          <View
            style={[
              styles.dialogCard,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            {dialog.title ? (
              <Text style={[styles.dialogTitle, { color: colors.text }]}>{dialog.title}</Text>
            ) : null}
            {dialog.message ? (
              <Text style={[styles.dialogMsg, { color: colors.textSecondary }]}>
                {dialog.message}
              </Text>
            ) : null}

            {dialog.kind === "prompt" ? (
              <TextInput
                value={promptValue}
                onChangeText={setPromptValue}
                placeholder={dialog.placeholder || ""}
                placeholderTextColor={colors.textTertiary}
                autoFocus={true}
                style={[
                  styles.promptInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.glassBorder,
                  },
                ]}
              />
            ) : null}

            {dialog.kind === "actionSheet" ? (
              <ScrollView style={{ maxHeight: 320, marginTop: 10 }}>
                {dialog.actions.map((act, idx) => (
                  <Pressable
                    key={`dact-${idx}`}
                    onPress={() => dialog.resolve(idx)}
                    style={[styles.dialogOption, { borderTopColor: colors.separator }]}
                  >
                    <Text
                      style={[
                        styles.dialogOptionText,
                        { color: act.role === "destructive" ? colors.danger : accent },
                      ]}
                    >
                      {act.label}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => dialog.resolve(null)}
                  style={[styles.dialogOption, { borderTopColor: colors.separator }]}
                >
                  <Text style={[styles.dialogOptionText, { color: colors.textSecondary }]}>取消</Text>
                </Pressable>
              </ScrollView>
            ) : (
              <View style={[styles.dialogBtnRow, { borderTopColor: colors.separator }]}>
                {dialog.kind === "confirm" || dialog.kind === "prompt" ? (
                  <Pressable
                    onPress={closeDialogWithCancel}
                    style={[
                      styles.dialogBtn,
                      {
                        borderRightWidth: StyleSheet.hairlineWidth,
                        borderRightColor: colors.separator,
                      },
                    ]}
                  >
                    <Text style={[styles.dialogBtnText, { color: colors.textSecondary }]}>
                      {dialog.cancelLabel || "取消"}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => {
                    if (dialog.kind === "alert") dialog.resolve()
                    else if (dialog.kind === "confirm") dialog.resolve(true)
                    else if (dialog.kind === "prompt") dialog.resolve(promptValue)
                  }}
                  style={styles.dialogBtn}
                >
                  <Text style={[styles.dialogBtnText, { color: accent, fontWeight: "700" }]}>
                    {dialog.kind === "alert" ? "确定" : dialog.confirmLabel || "确定"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      ) : null}

      {toast ? (
        <View
          pointerEvents="none"
          style={[styles.toastWrap, { top: insets.top + 56, zIndex: 600 }]}
        >
          <View
            style={[
              styles.toastPill,
              {
                backgroundColor:
                  toast.tone === "error"
                    ? colors.danger
                    : toast.tone === "success"
                      ? colors.green
                      : "rgba(28, 28, 30, 0.92)",
              },
            ]}
          >
            <Text style={styles.toastText} numberOfLines={2}>
              {toast.message}
            </Text>
          </View>
        </View>
      ) : null}
    </OverlayContext.Provider>
  )
}

export function useOverlay(): OverlayAPI {
  const ctx = useContext(OverlayContext)
  if (!ctx) {
    throw new Error("useOverlay must be used inside OverlayProvider")
  }
  return ctx
}

const styles = StyleSheet.create({
  portalLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  sheetCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    overflow: "hidden",
  },
  sheetHeader: {
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
  },
  sheetClose: {
    fontSize: 16,
    fontWeight: "600",
  },
  sheetBodyFlex: {
    flex: 1,
  },
  sheetBodyAuto: {
    flexShrink: 1,
  },
  actionSheetWrap: {
    paddingHorizontal: 12,
    gap: 8,
  },
  actionCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  actionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  actionMsg: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 17,
  },
  actionRow: {
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  actionRowText: {
    fontSize: 16,
    fontWeight: "500",
  },
  cancelCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 15,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "700",
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingTop: 18,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 18,
  },
  dialogMsg: {
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 18,
    marginTop: 8,
    lineHeight: 19,
  },
  promptInput: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
  dialogBtnRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
  },
  dialogBtn: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
  },
  dialogBtnText: {
    fontSize: 16,
  },
  dialogOption: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  dialogOptionText: {
    fontSize: 16,
    fontWeight: "500",
  },
  toastWrap: {
    position: "absolute",
    left: 20,
    right: 20,
    alignItems: "center",
  },
  toastPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    maxWidth: 340,
    elevation: 4,
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
})
