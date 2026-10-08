import {
  Button,
  Circle,
  FlowLayout,
  Group,
  HStack,
  Image,
  LazyVStack,
  LongPressGesture,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  type Color,
  type CommonViewProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "scripting"
import { appGlass, appInteractiveGlass, appThemeColor } from "./glass"
import { sheetDetents, sheetTopBar } from "./pageChrome"
import {
  addBookmark,
  addNovelBookmark,
  bookmarkDetail,
  followUser,
  novelBookmarkDetail,
  removeBookmark,
  removeNovelBookmark,
} from "../../api/pixiv"
import { session } from "../../api/session"
import { loadSettings } from "../../store/settings"
import { useIllustBookmark, useLatest, useNovelBookmark } from "../Hooks"
import { SelectableTagChip, TagChip } from "./TagChip"
import { CachedImage } from "./CachedImage"
import { LoadingView } from "./StatusViews"
import { CORNER_ICON_SIZE } from "./formatUtils"
import { triggerHaptic } from "../../platform/haptics"
import type {
  PixivBookmarkDetail,
  PixivBookmarkTag,
  PixivIllustration,
  PixivNovel,
  PixivPage,
  PixivTag,
} from "../../types"

interface BookmarkChipTag {
  name: string
  translated_name?: string
  count?: number
}

export function BookmarkDetailSheet(props: {
  item: { id: number; title: string; tags?: PixivTag[] }
  bookmarked: boolean
  loadDetail: (token: string) => Promise<PixivBookmarkDetail>
  loadTags: (restrict: "public" | "private", token: string) => Promise<PixivPage<PixivBookmarkTag>>
  save: (restrict: "public" | "private", tags: string[], token: string) => Promise<void>
  onSaved: () => void
  onClose: () => void
  customTagColor?: Color
}) {
  const customTagColor: Color =
    props.customTagColor ?? (appThemeColor("systemBlue") as Color)
  const [availableTags, setAvailableTags] = useState<BookmarkChipTag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState("")
  const [showCustomTagInput, setShowCustomTagInput] = useState(false)
  const [inputSeq, setInputSeq] = useState(0)
  const [restrict, setRestrict] = useState<"public" | "private">("public")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setInteractive(true)
    }, 400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDetail() {
      setCustomTag("")
      setShowCustomTagInput(false)
      const userID = session.userID
      if (!userID) {
        setLoading(false)
        return
      }
      try {
        const [detail, publicTags, privateTags] = await Promise.all([
          session.call(props.loadDetail),
          session.call((token) => props.loadTags("public", token)),
          session.call((token) => props.loadTags("private", token)),
        ])
        if (cancelled) return
        setSelectedTags(
          detail.is_bookmarked
            ? (detail.tags ?? [])
                .filter((tag) => tag.is_registered)
                .map((tag) => tag.name)
            : []
        )
        setRestrict(detail.restrict === "private" ? "private" : "public")
        const merged = new Map<string, BookmarkChipTag>()

        // 1. 优先注入当前作品自带的标签（含中文译名）
        if (Array.isArray(props.item.tags)) {
          for (const t of props.item.tags) {
            const trimmed = t?.name?.trim()
            if (trimmed) {
              merged.set(trimmed, {
                name: trimmed,
                translated_name: t.translated_name ?? undefined,
              })
            }
          }
        }

        // 2. 注入作品已有收藏标签
        for (const tag of detail.tags ?? []) {
          const trimmed = tag.name?.trim()
          if (!trimmed) continue
          const existing = merged.get(trimmed)
          if (!existing) {
            merged.set(trimmed, { name: trimmed, count: 0 })
          }
        }

        // 3. 注入用户常用收藏标签
        for (const tag of [...publicTags.items, ...privateTags.items]) {
          const trimmed = tag.name?.trim()
          if (!trimmed) continue
          const existing = merged.get(trimmed)
          if (existing) {
            if (existing.count === undefined && tag.count !== undefined) {
              existing.count = tag.count
            }
          } else {
            merged.set(trimmed, tag)
          }
        }
        setAvailableTags(Array.from(merged.values()).slice(0, 40))
      } catch {
        if (!cancelled) setError("收藏信息加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [props.item.id])

  function toggleTag(name: string) {
    if (!interactive) return
    triggerHaptic("selection")
    setSelectedTags((current) =>
      current.includes(name)
        ? current.filter((tag) => tag !== name)
        : current.length >= 10
          ? current
          : [...current, name]
    )
  }

  function openCustomTagInput() {
    if (!interactive) return
    withAnimation(() => {
      setShowCustomTagInput(true)
      setInputSeq(Date.now())
    })
  }

  function addCustomTag() {
    const name = customTag.trim()
    if (!name || selectedTags.includes(name) || selectedTags.length >= 10) return
    triggerHaptic("selection")
    setAvailableTags((current) =>
      current.some((tag) => tag.name === name)
        ? current
        : [{ name, count: 0 }, ...current]
    )
    setSelectedTags((current) => [...current, name])
    setCustomTag("")
    withAnimation(() => {
      setShowCustomTagInput(false)
    })
  }

  function close() {
    setCustomTag("")
    setShowCustomTagInput(false)
    props.onClose()
  }

  async function save() {
    if (saving) return
    triggerHaptic("medium")
    setSaving(true)
    setError(null)
    try {
      await session.call((token) =>
        props.save(restrict, selectedTags, token)
      )
      props.onSaved()
      close()
    } catch {
      setError("收藏保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <NavigationStack
      presentationDetents={sheetDetents()}
      presentationDragIndicator="visible"
    >
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        {...sheetTopBar()}
        navigationTitle="收藏"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button
              action={close}
            >
              <Image systemName="xmark" />
            </Button>
          ),
          topBarTrailing: (
            <Button
              disabled={saving || loading}
              action={() => void save()}
            >
              <Image
                systemName={props.bookmarked ? "heart.fill" : "heart"}
                foregroundStyle={props.bookmarked && !saving ? "systemPink" : undefined}
              />
            </Button>
          ),
        }}
      >
        {error ? (
          <Text
            font="footnote"
            foregroundStyle="systemRed"
            padding={{ horizontal: 16, top: 4, bottom: 6 }}
          >
            {error}
          </Text>
        ) : null}

        {/* 中间主体内容区 */}
        {loading ? (
          <LoadingView />
        ) : (
          <ScrollView
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            presentationContentInteraction="scrolls"
            safeAreaInset={
              showCustomTagInput
                ? {
                    bottom: {
                      content: (
                        <VStack
                          padding={{ horizontal: 8, top: 6, bottom: 8 }}
                          frame={{ maxWidth: "infinity" }}
                        >
                          <HStack
                            spacing={8}
                            alignment="center"
                            frame={{ maxWidth: "infinity" }}
                          >
                            {/* 左侧：独立圆形标签毛玻璃徽标（支持点击收起） */}
                            <Button
                              buttonStyle="plain"
                              frame={{ width: 36, height: 36 }}
                              glassEffect={appGlass("circle")}
                              contentShape="circle"
                              action={() => {
                                withAnimation(() => {
                                  setShowCustomTagInput(false)
                                  setCustomTag("")
                                })
                              }}
                            >
                              <Image
                                systemName="tag.fill"
                                font="body"
                                foregroundStyle={customTagColor}
                              />
                            </Button>

                            {/* 中间：胶囊毛玻璃输入框 */}
                            <HStack
                              alignment="center"
                              padding={{ horizontal: 12, vertical: 6 }}
                              glassEffect={appGlass("capsule")}
                              frame={{ maxWidth: "infinity" }}
                            >
                              <TextField
                                key={`custom-tag-${inputSeq}`}
                                title="自定义标签"
                                prompt="输入自定义标签名称…"
                                value={customTag}
                                onChanged={setCustomTag}
                                onSubmit={addCustomTag}
                                submitLabel="done"
                                textFieldStyle="plain"
                                autofocus={true}
                                frame={{ maxWidth: "infinity" }}
                              />
                            </HStack>

                            {/* 右侧：独立圆形加号提交按钮 */}
                            <Button
                              buttonStyle="plain"
                              frame={{ width: 36, height: 36 }}
                              glassEffect={
                                customTag.trim() && selectedTags.length < 10
                                  ? undefined
                                  : appGlass("circle")
                              }
                              contentShape="circle"
                              disabled={!customTag.trim() || selectedTags.length >= 10}
                              action={addCustomTag}
                            >
                              <ZStack frame={{ width: 36, height: 36 }} alignment="center">
                                {customTag.trim() && selectedTags.length < 10 ? (
                                  <Circle fill={customTagColor} frame={{ width: 36, height: 36 }} />
                                ) : null}
                                <Image
                                  systemName="plus"
                                  font="body"
                                  fontWeight="semibold"
                                  foregroundStyle={
                                    customTag.trim() && selectedTags.length < 10
                                      ? "white"
                                      : "tertiaryLabel"
                                  }
                                />
                              </ZStack>
                            </Button>
                          </HStack>
                        </VStack>
                      ),
                    },
                  }
                : undefined
            }
          >
            <VStack
              alignment="leading"
              spacing={12}
              padding={{ horizontal: 8, bottom: showCustomTagInput ? 12 : 24 }}
              frame={{ maxWidth: "infinity" }}
              onTapGesture={() => {
                if (showCustomTagInput) {
                  setShowCustomTagInput(false)
                  setCustomTag("")
                }
              }}
            >
              {/* 私密收藏设置卡片 */}
              <HStack
                spacing={10}
                alignment="center"
                padding={{ horizontal: 12, vertical: 10 }}
                glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
                frame={{ maxWidth: "infinity" }}
              >
                <Image
                  systemName={restrict === "private" ? "lock.fill" : "lock.open"}
                  font="body"
                  foregroundStyle={restrict === "private" ? "systemOrange" : "secondaryLabel"}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text font="subheadline" fontWeight="medium">
                    私密收藏
                  </Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {restrict === "private" ? "仅自己可见，不公开展示" : "公开展示在个人主页收藏列表"}
                  </Text>
                </VStack>
                <Spacer />
                <Toggle
                  title=""
                  value={restrict === "private"}
                  onChanged={(value) => setRestrict(value ? "private" : "public")}
                />
              </HStack>

              {/* 标签选择区 */}
              <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
                <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="subheadline" fontWeight="semibold">
                    选择标签
                  </Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {selectedTags.length} / 10
                  </Text>
                </HStack>

                <FlowLayout spacing={4}>
                  {availableTags.map((tag) => {
                    const selected = selectedTags.includes(tag.name)
                    return (
                      <SelectableTagChip
                        key={tag.name}
                        name={tag.name}
                        translatedName={tag.translated_name}
                        selected={selected}
                        accentColor={customTagColor}
                        disabled={!selected && selectedTags.length >= 10}
                        onToggle={() => toggleTag(tag.name)}
                      />
                    )
                  })}
                  <Button
                    title="自定义标签"
                    systemImage="plus"
                    buttonStyle="glass"
                    tint={customTagColor}
                    controlSize="small"
                    disabled={selectedTags.length >= 10}
                    action={openCustomTagInput}
                  />
                </FlowLayout>
              </VStack>
            </VStack>
          </ScrollView>
        )}
      </VStack>
    </NavigationStack>
  )
}

export function BookmarkButton(props: {
  bookmarked: boolean
  disabled: boolean
  onTap: () => void
  onLongPress: () => void
  sheetContent?: any
  sheetPresented?: boolean
  onSheetChanged?: (presented: boolean) => void
  size?: number
  hero?: boolean
  shadow?: CommonViewProps["shadow"]
  offset?: { x: number; y: number }
}) {
  const [longPressLocked, setLongPressLocked] = useState(false)
  const size = props.size ?? (props.hero ? 34 : 30)
  const offset = props.offset ?? { x: -6, y: -6 }
  const shadow =
    props.shadow ??
    (props.hero
      ? { color: "#00000028", radius: 8, y: 2 }
      : { color: "#00000028", radius: 6, y: 2 })
  const iconFont = props.hero ? "title3" : "body"

  return (
    <ZStack
      alignment="center"
      frame={{ width: size, height: size }}
      contentShape="circle"
      zIndex={2}
      offset={offset}
      shadow={shadow}
      allowsHitTesting={!props.disabled && !longPressLocked}
      sheet={
        props.sheetContent && props.onSheetChanged
          ? {
              content: props.sheetContent,
              isPresented: props.sheetPresented ?? false,
              onChanged: props.onSheetChanged,
            }
          : undefined
      }
    >
      <Button
        action={() => {
          triggerHaptic("light")
          props.onTap()
        }}
        buttonStyle="plain"
        frame={{ width: size, height: size }}
        glassEffect={appInteractiveGlass("circle")}
        contentShape="circle"
        disabled={props.disabled || longPressLocked}
        simultaneousGesture={
          LongPressGesture({ minDuration: 500 }).onEnded(() => {
            setLongPressLocked(true)
            props.onLongPress()
            setTimeout(() => setLongPressLocked(false), 1500)
          })
        }
      >
        <Image
          systemName={props.bookmarked ? "heart.fill" : "heart"}
          font={iconFont}
          foregroundStyle={props.bookmarked ? "systemPink" : undefined}
        />
      </Button>
    </ZStack>
  )
}
