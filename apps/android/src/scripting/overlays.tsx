import React, { useEffect, useState } from "react"
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import {
  dismissActiveDialog,
  subscribeDialog,
  type DialogRequest,
} from "./hostGlobals"
import { SFSymbolIcon } from "./sfSymbols"
import { resolveColor, ThemeContext, useTheme } from "./theme"

// ---------- Menu Sheet Bus (for <Menu> and contextMenu) ----------
export interface MenuSheetItem {
  title: string
  systemImage?: string
  role?: string
  disabled?: boolean
  checked?: boolean
  action: () => void
}

export interface MenuSheetRequest {
  title?: string
  items: MenuSheetItem[]
}

let activeMenuRequest: MenuSheetRequest | null = null
const menuListeners = new Set<(req: MenuSheetRequest | null) => void>()

export function openMenuSheet(req: MenuSheetRequest) {
  activeMenuRequest = req
  menuListeners.forEach((l) => l(req))
}

export function closeMenuSheet() {
  activeMenuRequest = null
  menuListeners.forEach((l) => l(null))
}

export function extractMenuItemsFromNode(node: any): MenuSheetItem[] {
  const result: MenuSheetItem[] = []
  function visit(n: any) {
    if (!n) return
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (!React.isValidElement(n)) return
    const p: any = n.props || {}
    const typeName = typeof n.type === "function" ? (n.type as any).displayName || n.type.name : ""

    if (typeName === "ScriptingButton" || typeName === "Button" || typeof p.action === "function") {
      const label =
        typeof p.title === "string"
          ? p.title
          : extractTextFromChildren(p.children) || "操作"
      result.push({
        title: label,
        systemImage: p.systemImage,
        role: p.role,
        disabled: Boolean(p.disabled),
        action: () => p.action?.(),
      })
      return
    }
    if (typeName === "ScriptingPicker" || typeName === "Picker") {
      const opts = collectPickerOptions(p.children)
      for (const opt of opts) {
        result.push({
          title: opt.label,
          checked: opt.value === p.value,
          action: () => p.onChanged?.(opt.value),
        })
      }
      return
    }
    if (typeName === "ScriptingMenu" || typeName === "Menu") {
      const subItems = extractMenuItemsFromNode(p.children)
      if (subItems.length > 0) {
        const subTitle = typeof p.title === "string" ? p.title : extractTextFromChildren(p.label) || "子菜单"
        result.push({
          title: `${subTitle} ▸`,
          systemImage: p.systemImage,
          action: () => openMenuSheet({ title: subTitle, items: subItems }),
        })
      }
      return
    }
    if (p.children) visit(p.children)
  }
  visit(node)
  return result
}

export function extractTextFromChildren(children: any): string {
  if (children == null || typeof children === "boolean") return ""
  if (typeof children === "string" || typeof children === "number") return String(children)
  if (Array.isArray(children)) return children.map(extractTextFromChildren).filter(Boolean).join(" ")
  if (React.isValidElement(children)) {
    const p: any = children.props || {}
    if (typeof p.title === "string") return p.title
    return extractTextFromChildren(p.children)
  }
  return ""
}

export function collectPickerOptions(children: any): Array<{ value: any; label: string }> {
  const out: Array<{ value: any; label: string }> = []
  function walk(n: any) {
    if (!n) return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (React.isValidElement(n)) {
      const p: any = n.props || {}
      if ("tag" in p) {
        out.push({
          value: p.tag,
          label: extractTextFromChildren(p.children) || String(p.tag),
        })
        return
      }
      if (p.children) walk(p.children)
    }
  }
  walk(children)
  return out
}

// ---------- Imperative Navigation.present Modal Stack ----------
export interface PresentedModalEntry {
  id: number
  element: React.ReactElement
  fullScreen: boolean
  resolve: () => void
}

let modalIdSeq = 1
let presentedModals: PresentedModalEntry[] = []
const modalListeners = new Set<(entries: PresentedModalEntry[]) => void>()

export function pushPresentedModal(element: React.ReactElement, fullScreen: boolean): Promise<void> {
  return new Promise((resolve) => {
    const id = modalIdSeq++
    presentedModals = [...presentedModals, { id, element, fullScreen, resolve }]
    modalListeners.forEach((l) => l(presentedModals))
  })
}

export function dismissPresentedModalById(id: number): boolean {
  const target = presentedModals.find((m) => m.id === id)
  if (!target) return false
  presentedModals = presentedModals.filter((m) => m.id !== id)
  modalListeners.forEach((l) => l(presentedModals))
  target.resolve()
  return true
}

export function dismissTopPresentedModal(): boolean {
  if (presentedModals.length === 0) return false
  const top = presentedModals[presentedModals.length - 1]
  return dismissPresentedModalById(top.id)
}

export const DismissContext = React.createContext<() => void>(() => {})

// ---------- Global Host Overlay Component ----------
export function ScriptingOverlayHost() {
  const theme = useTheme()
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [promptValue, setPromptValue] = useState("")
  const [menuReq, setMenuReq] = useState<MenuSheetRequest | null>(activeMenuRequest)
  const [modals, setModals] = useState<PresentedModalEntry[]>(presentedModals)

  useEffect(() => subscribeDialog((req) => {
    setDialog(req)
    if (req?.kind === "prompt") {
      setPromptValue(req.defaultValue ?? "")
    }
  }), [])

  useEffect(() => {
    menuListeners.add(setMenuReq)
    return () => {
      menuListeners.delete(setMenuReq)
    }
  }, [])

  useEffect(() => {
    modalListeners.add(setModals)
    return () => {
      modalListeners.delete(setModals)
    }
  }, [])

  const cardBg = theme.isDark ? "#1C1C1E" : "#FFFFFF"
  const textColor = theme.isDark ? "#F9FAFB" : "#111827"
  const subColor = theme.isDark ? "#9CA3AF" : "#6B7280"
  const borderColor = theme.isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"

  return (
    <>
      {/* Imperative Navigation.present Modals */}
      {modals.map((entry) => (
        <Modal
          key={`modal-${entry.id}`}
          visible={true}
          animationType="slide"
          transparent={!entry.fullScreen}
          onRequestClose={() => dismissPresentedModalById(entry.id)}
        >
          <DismissContext.Provider value={() => dismissPresentedModalById(entry.id)}>
            <ThemeContext.Provider value={theme}>
              <View style={[styles.modalContainer, !entry.fullScreen && styles.sheetBackdrop]}>
                {entry.fullScreen ? (
                  entry.element
                ) : (
                  <View style={[styles.sheetCard, { backgroundColor: theme.isDark ? "#000000" : "#F2F2F7" }]}>
                    {entry.element}
                  </View>
                )}
              </View>
            </ThemeContext.Provider>
          </DismissContext.Provider>
        </Modal>
      ))}

      {/* Menu Action Sheet Modal */}
      {menuReq ? (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={closeMenuSheet}
        >
          <Pressable style={styles.dialogBackdrop} onPress={closeMenuSheet}>
            <Pressable style={[styles.menuSheet, { backgroundColor: cardBg, borderColor }]} onPress={() => {}}>
              {menuReq.title ? (
                <Text style={[styles.menuTitle, { color: subColor, borderBottomColor: borderColor }]}>
                  {menuReq.title}
                </Text>
              ) : null}
              <ScrollView style={{ maxHeight: 420 }}>
                {menuReq.items.map((item, idx) => (
                  <TouchableOpacity
                    key={`mitem-${idx}`}
                    disabled={item.disabled}
                    onPress={() => {
                      closeMenuSheet()
                      setTimeout(() => item.action(), 10)
                    }}
                    style={[
                      styles.menuRow,
                      { borderBottomColor: borderColor },
                      item.disabled && { opacity: 0.4 },
                    ]}
                  >
                    <View style={styles.menuRowLeft}>
                      {item.checked ? (
                        <SFSymbolIcon name="checkmark" size={16} color={theme.tint} />
                      ) : item.systemImage ? (
                        <SFSymbolIcon
                          name={item.systemImage}
                          size={16}
                          color={item.role === "destructive" ? "#FF3B30" : textColor}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.menuRowText,
                          { color: item.role === "destructive" ? "#FF3B30" : textColor },
                        ]}
                      >
                        {item.title}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity onPress={closeMenuSheet} style={styles.menuCancel}>
                <Text style={[styles.menuCancelText, { color: theme.tint }]}>取消</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Dialog (alert / confirm / prompt / actionSheet) */}
      {dialog ? (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            if (dialog.kind === "alert") dialog.resolve()
            else if (dialog.kind === "confirm") dialog.resolve(false)
            else if (dialog.kind === "actionSheet") dialog.resolve(null)
            else if (dialog.kind === "prompt") dialog.resolve(null)
          }}
        >
          <View style={styles.dialogBackdrop}>
            <View style={[styles.dialogCard, { backgroundColor: cardBg, borderColor }]}>
              {dialog.title ? <Text style={[styles.dialogTitle, { color: textColor }]}>{dialog.title}</Text> : null}
              {dialog.message ? <Text style={[styles.dialogMsg, { color: subColor }]}>{dialog.message}</Text> : null}

              {dialog.kind === "prompt" ? (
                <TextInput
                  value={promptValue}
                  onChangeText={setPromptValue}
                  placeholder={dialog.placeholder || ""}
                  placeholderTextColor={subColor}
                  autoFocus={true}
                  style={[styles.promptInput, { color: textColor, borderColor, backgroundColor: theme.isDark ? "#2C2C2E" : "#F3F4F6" }]}
                />
              ) : null}

              {dialog.kind === "actionSheet" ? (
                <ScrollView style={{ maxHeight: 340, marginTop: 10 }}>
                  {dialog.actions.map((act, idx) => (
                    <TouchableOpacity
                      key={`act-${idx}`}
                      onPress={() => dialog.resolve(idx)}
                      style={[styles.sheetOptionBtn, { borderTopColor: borderColor }]}
                    >
                      <Text
                        style={[
                          styles.sheetOptionText,
                          { color: act.role === "destructive" ? "#FF3B30" : theme.tint },
                        ]}
                      >
                        {act.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => dialog.resolve(null)}
                    style={[styles.sheetOptionBtn, { borderTopColor: borderColor }]}
                  >
                    <Text style={[styles.sheetOptionText, { color: subColor, fontWeight: "600" }]}>取消</Text>
                  </TouchableOpacity>
                </ScrollView>
              ) : (
                <View style={[styles.dialogBtnRow, { borderTopColor: borderColor }]}>
                  {dialog.kind === "confirm" || dialog.kind === "prompt" ? (
                    <TouchableOpacity
                      onPress={() => {
                        if (dialog.kind === "confirm") dialog.resolve(false)
                        else dialog.resolve(null)
                      }}
                      style={[styles.dialogBtn, { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: borderColor }]}
                    >
                      <Text style={[styles.dialogBtnText, { color: subColor }]}>
                        {dialog.cancelLabel || "取消"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      if (dialog.kind === "alert") dialog.resolve()
                      else if (dialog.kind === "confirm") dialog.resolve(true)
                      else if (dialog.kind === "prompt") dialog.resolve(promptValue)
                    }}
                    style={styles.dialogBtn}
                  >
                    <Text style={[styles.dialogBtnText, { color: theme.tint, fontWeight: "600" }]}>
                      {dialog.kind === "alert" ? "确定" : dialog.confirmLabel || "确定"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  )
}

export function PresentationHostWrapper({
  props,
  children,
}: {
  props: Record<string, any>
  children: React.ReactElement
}) {
  const theme = useTheme()
  const sheet = props.sheet
  const fullScreenCover = props.fullScreenCover
  const isSheetOpen = Boolean(sheet?.isPresented)
  const isCoverOpen = Boolean(fullScreenCover?.isPresented)

  return (
    <>
      {children}
      {isSheetOpen ? (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => sheet?.onChanged?.(false)}
        >
          <DismissContext.Provider value={() => sheet?.onChanged?.(false)}>
            <ThemeContext.Provider value={theme}>
              <View style={styles.sheetBackdrop}>
                <Pressable style={{ height: 48 }} onPress={() => sheet?.onChanged?.(false)} />
                <View style={[styles.sheetCard, { backgroundColor: resolveColor("systemBackground", theme.isDark, "#F2F2F7") }]}>
                  {typeof sheet?.content === "function" ? sheet.content() : sheet?.content}
                </View>
              </View>
            </ThemeContext.Provider>
          </DismissContext.Provider>
        </Modal>
      ) : null}
      {isCoverOpen ? (
        <Modal
          visible={true}
          animationType="slide"
          transparent={false}
          onRequestClose={() => fullScreenCover?.onChanged?.(false)}
        >
          <DismissContext.Provider value={() => fullScreenCover?.onChanged?.(false)}>
            <ThemeContext.Provider value={theme}>
              <View style={styles.modalContainer}>
                {typeof fullScreenCover?.content === "function" ? fullScreenCover.content() : fullScreenCover?.content}
              </View>
            </ThemeContext.Provider>
          </DismissContext.Provider>
        </Modal>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  modalContainer: { flex: 1 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" },
  sheetCard: { flex: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialogCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingTop: 18,
  },
  dialogTitle: { fontSize: 17, fontWeight: "700", textAlign: "center", paddingHorizontal: 18 },
  dialogMsg: { fontSize: 13, textAlign: "center", paddingHorizontal: 18, marginTop: 8, lineHeight: 19 },
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
  dialogBtn: { flex: 1, paddingVertical: 13, alignItems: "center" },
  dialogBtnText: { fontSize: 16 },
  sheetOptionBtn: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 13, alignItems: "center", paddingHorizontal: 16 },
  sheetOptionText: { fontSize: 16 },
  menuSheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  menuTitle: { fontSize: 13, fontWeight: "600", textAlign: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  menuRow: { paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  menuRowLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  menuRowText: { fontSize: 16 },
  menuCancel: { paddingVertical: 13, alignItems: "center" },
  menuCancelText: { fontSize: 16, fontWeight: "600" },
})
