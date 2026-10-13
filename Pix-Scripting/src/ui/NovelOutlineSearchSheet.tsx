import {
  Button,
  Divider,
  HStack,
  Image,
  NavigationStack,
  Picker,
  ScrollView,
  Spacer,
  Text,
  TextField,
  useCallback,
  useMemo,
  useState,
  VStack,
} from "scripting"
import { appGlass } from "./components/glass"
import { sheetDetents, sheetTopBar } from "./components/pageChrome"
import { triggerHaptic } from "../platform/haptics"
import {
  activeOutlineEntry,
  buildEpisodeOutline,
  outlineEntryLabel,
  type NovelOutlineEntry,
} from "../store/novelOutline"
import {
  normalizeHits,
  searchNovelChunks,
  searchSummary,
  stepHitIndex,
  type NovelSearchHit,
} from "../store/novelSearch"
import type { AnchorChunkLike } from "../store/novelAnchor"
import type { NovelChunkItem } from "./NovelReader"

export interface NovelJumpTarget {
  chunkId: string
  quote?: string
  offset: number
  page: number
  /** 跳转来源：目录 / 检索命中，便于调用方记录「返回原位置」 */
  from: "outline" | "search"
}

export interface NovelOutlineSearchSheetProps {
  /** 本篇标题，用于区分系列内的其它话 */
  title: string
  /** 本篇（当前话）的正文块；目录与检索都只在本篇范围内进行 */
  chunks: NovelChunkItem[]
  /** 当前阅读块 id，用于目录高亮 */
  currentChunkId?: string | null
  currentPage?: number
  /** 跳转回调：调用方负责滚动 + 高亮 */
  onJump: (target: NovelJumpTarget) => void
  /** 返回跳转前的位置；未发生过跳转时禁用 */
  onReturn?: () => void
  canReturn?: boolean
  onClose?: () => void
}

/**
 * 目录 / 正文检索面板。
 *
 * 范围约束：只使用当前话的块（chunks），系列其它话的目录由系列页负责，
 * 绝不把系列目录混进本篇目录。
 */
export function NovelOutlineSearchSheet(props: NovelOutlineSearchSheetProps) {
  const { title, chunks, currentChunkId, currentPage, onJump, onReturn, canReturn, onClose } = props
  const [tab, setTab] = useState<"outline" | "search">("outline")
  const [query, setQuery] = useState("")
  const [hitIndex, setHitIndex] = useState(-1)

  const list = useMemo<AnchorChunkLike[]>(() => (Array.isArray(chunks) ? chunks : []), [chunks])
  const outline = useMemo(() => buildEpisodeOutline(list), [list])
  const indexById = useMemo(() => {
    const map = new Map<string, number>()
    list.forEach((chunk, index) => map.set(chunk.id, index))
    return map
  }, [list])
  const active = useMemo(
    () => activeOutlineEntry(outline, {
      chunkIndex: currentChunkId ? indexById.get(currentChunkId) ?? -1 : -1,
      page: currentPage ?? 0,
    }),
    [outline, currentChunkId, currentPage, indexById]
  )

  const hits = useMemo<NovelSearchHit[]>(() => normalizeHits(searchNovelChunks(list, query)), [list, query])
  const summary = useMemo(() => searchSummary(hits, hitIndex, query), [hits, hitIndex, query])

  const jumpToHit = useCallback((index: number) => {
    if (hits.length === 0) return
    const bounded = ((index % hits.length) + hits.length) % hits.length
    setHitIndex(bounded)
    const hit = hits[bounded]
    triggerHaptic("selection")
    onJump({
      chunkId: hit.chunkId,
      quote: hit.match,
      offset: hit.matchStart,
      page: hit.page,
      from: "search",
    })
  }, [hits, onJump])

  const handleOutlineJump = useCallback((entry: NovelOutlineEntry) => {
    triggerHaptic("selection")
    onJump({ chunkId: entry.id, offset: 0, page: entry.page, from: "outline" })
  }, [onJump])

  return (
    <NavigationStack
      presentationDetents={sheetDetents([0.62, "large"])}
      presentationDragIndicator="visible"
    >
      <ScrollView
        {...sheetTopBar()}
        navigationTitle="目录与检索"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: onClose
            ? [<Button key="close" title="关闭" systemImage="xmark" action={onClose} />]
            : undefined,
        }}
      >
        <VStack spacing={12} padding={{ horizontal: 8, bottom: 32 }} frame={{ maxWidth: "infinity" }}>
          <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>
              {title}
            </Text>
            <Picker title="" value={tab} onChanged={(value: string) => setTab(value as "outline" | "search")}>
              <Text tag="outline">目录</Text>
              <Text tag="search">正文检索</Text>
            </Picker>
          </VStack>

          {tab === "outline" ? (
            <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
              {outline.length === 0 ? (
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  本篇没有章节或分页标记；如需要可在正文中使用 [chapter:标题] 与 [newpage]。
                </Text>
              ) : (
                <VStack
                  spacing={0}
                  glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
                  contentShape={{ type: "rect", cornerRadius: 14 }}
                  frame={{ maxWidth: "infinity" }}
                >
                  {outline.map((entry, index) => (
                    <VStack key={entry.id} spacing={0} frame={{ maxWidth: "infinity" }}>
                      {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
                      <Button
                        buttonStyle="plain"
                        action={() => handleOutlineJump(entry)}
                      >
                        <HStack
                          alignment="center"
                          spacing={10}
                          padding={{ horizontal: 16, vertical: 12 }}
                          frame={{ maxWidth: "infinity" }}
                        >
                          <Image
                            systemName={entry.kind === "chapter" ? "text.book.closed" : "doc.text"}
                            font="footnote"
                            foregroundStyle={entry.kind === "chapter" ? "systemBlue" : "secondaryLabel"}
                          />
                          <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                            <Text
                              font="body"
                              fontWeight={active?.id === entry.id ? "bold" : "regular"}
                              foregroundStyle={active?.id === entry.id ? "systemBlue" : "label"}
                              lineLimit={2}
                            >
                              {outlineEntryLabel(entry)}
                            </Text>
                            <Text font="caption2" foregroundStyle="secondaryLabel">
                              {entry.kind === "chapter" ? `第 ${entry.page} 页` : "分页标记"}
                            </Text>
                          </VStack>
                          {active?.id === entry.id ? (
                            <Image systemName="checkmark" font="footnote" foregroundStyle="systemBlue" />
                          ) : null}
                        </HStack>
                      </Button>
                    </VStack>
                  ))}
                </VStack>
              )}
            </VStack>
          ) : (
            <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
              <TextField
                title="关键词"
                prompt="在本篇正文中检索"
                value={query}
                onChanged={(value: string) => {
                  setQuery(value)
                  setHitIndex(-1)
                }}
              />

              {query.trim() ? (
                <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
                  <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
                    <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {summary}
                    </Text>
                    <Spacer />
                    <Button
                      title="上一处"
                      systemImage="chevron.up"
                      buttonStyle="borderless"
                      disabled={hits.length === 0}
                      action={() => jumpToHit(stepHitIndex(hitIndex, hits.length, -1))}
                    />
                    <Button
                      title="下一处"
                      systemImage="chevron.down"
                      buttonStyle="borderless"
                      disabled={hits.length === 0}
                      action={() => jumpToHit(stepHitIndex(hitIndex, hits.length, 1))}
                    />
                  </HStack>

                  {hits.length === 0 ? (
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      未找到匹配内容；检索只在本篇正文与章节标题内进行。
                    </Text>
                  ) : (
                    <VStack
                      spacing={0}
                      glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
                      contentShape={{ type: "rect", cornerRadius: 14 }}
                      frame={{ maxWidth: "infinity" }}
                    >
                      {hits.map((hit, index) => (
                        <VStack key={`${hit.chunkId}#${hit.matchStart}`} spacing={0} frame={{ maxWidth: "infinity" }}>
                          {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
                          <Button buttonStyle="plain" action={() => jumpToHit(index)}>
                            <HStack
                              alignment="top"
                              spacing={10}
                              padding={{ horizontal: 16, vertical: 11 }}
                              frame={{ maxWidth: "infinity" }}
                            >
                              <Text font="caption2" foregroundStyle="secondaryLabel">
                                {hit.page}
                              </Text>
                              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                                <Text font="footnote" lineLimit={3}>
                                  {`…${hit.before}`}
                                  <Text font="footnote" fontWeight="bold" foregroundStyle="systemOrange">
                                    {hit.match}
                                  </Text>
                                  {`${hit.after}…`}
                                </Text>
                              </VStack>
                              {hitIndex === index ? (
                                <Image systemName="checkmark" font="caption2" foregroundStyle="systemBlue" />
                              ) : null}
                            </HStack>
                          </Button>
                        </VStack>
                      ))}
                    </VStack>
                  )}
                </VStack>
              ) : (
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  输入关键词后按「下一处」逐条跳转，命中片段会高亮显示。
                </Text>
              )}
            </VStack>
          )}

          {onReturn ? (
            <Button
              title="返回原位置"
              systemImage="arrow.uturn.backward"
              buttonStyle="borderless"
              disabled={!canReturn}
              action={() => {
                triggerHaptic("light")
                onReturn()
              }}
            />
          ) : null}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
