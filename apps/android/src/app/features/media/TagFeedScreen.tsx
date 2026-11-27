import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  nextIllustrations,
  nextNovels,
  searchIllustrations,
  searchNovels,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { nextPixivision, pixivisionByTag } from "../../../../../../Pix-Scripting/src/api/pixivision"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  blockTag,
  isTagBlocked,
  onBlocklistChanged,
  unblockTag,
} from "../../../../../../Pix-Scripting/src/store/blocklist"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import { getTagInfo } from "../../../../../../Pix-Scripting/src/store/tagInfoCache"
import type {
  PixivIllustration,
  PixivNovel,
  PixivTagDetail,
  PixivisionArticle,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ChipBar,
  EmptyView,
  ErrorView,
  HeaderIconButton,
  IllustMasonryFeed,
  InlineFooterLoader,
  LoadingView,
  NovelFeedList,
  PixImage,
  ScreenHeader,
  SegmentedControl,
  usePixivFeed,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import {
  filterNovelsByMinTextLength,
  formatMinTextLengthLabel,
  minTextLengthForLongNovelFilter,
  NOVEL_LONG_FORM_MIN_TEXT_LENGTH,
} from "../feeds/novelLengthFilter"
import { openExternalUrl } from "./mediaHelpers"

type TagFeedKind = "illust" | "novel" | "pixivision"
type TagSort = "date_desc" | "popular_desc" | "date_asc"

function parseDisplayTag(rawTag: string): { display: string; queryKey: string } {
  if (rawTag.includes("?name=")) {
    const [idPart, namePart] = rawTag.split("?name=")
    let decoded = namePart || idPart
    if (namePart) {
      try {
        decoded = decodeURIComponent(namePart)
      } catch {
        decoded = namePart
      }
    }
    return { display: decoded || idPart, queryKey: rawTag }
  }
  return { display: rawTag, queryKey: rawTag }
}

export function TagFeedScreen({
  tag,
  kind: initialKind,
}: {
  tag: string
  kind: TagFeedKind
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const { display: displayTag, queryKey } = useMemo(() => parseDisplayTag(tag), [tag])
  const [kind, setKind] = useState<TagFeedKind>(initialKind)
  const [sort, setSort] = useState<TagSort>("date_desc")
  // 仅作用于小说列表；与 iOS v1.8.14.3 一样按 Pixiv text_length 过滤。
  const [onlyLongNovel, setOnlyLongNovel] = useState(false)
  const novelMinTextLength = minTextLengthForLongNovelFilter(onlyLongNovel)
  const [tagInfo, setTagInfo] = useState<PixivTagDetail | null>(null)
  const [wikiExpanded, setWikiExpanded] = useState(false)
  const [blocked, setBlocked] = useState<boolean>(() => isTagBlocked(displayTag))

  useEffect(() => {
    setKind(initialKind)
  }, [initialKind, tag])

  useEffect(() => {
    setBlocked(isTagBlocked(displayTag))
    return onBlocklistChanged(() => setBlocked(isTagBlocked(displayTag)))
  }, [displayTag])

  useEffect(() => {
    let active = true
    setTagInfo(null)
    void getTagInfo(displayTag)
      .then((info) => {
        if (active) setTagInfo(info)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [displayTag])

  const illustFilter = useCallback(
    (items: PixivIllustration[]) => items.filter((it) => isIllustContentVisible(it)),
    [],
  )
  const novelFilter = useCallback(
    (items: PixivNovel[]) =>
      filterNovelsByMinTextLength(
        items.filter((it) => isNovelContentVisible(it)),
        novelMinTextLength,
      ),
    [novelMinTextLength],
  )

  const illustFeed = usePixivFeed<PixivIllustration>({
    enabled: kind === "illust",
    deps: [displayTag, sort],
    filter: illustFilter,
    fetcher: (token) =>
      searchIllustrations(
        {
          word: displayTag,
          target: "exact_match_for_tags",
          sort,
        },
        token,
      ),
    fetchMore: (nextURL, token) => nextIllustrations(nextURL, token),
  })

  const novelFeed = usePixivFeed<PixivNovel>({
    enabled: kind === "novel",
    deps: [displayTag, sort, novelMinTextLength],
    filter: novelFilter,
    fetcher: (token) =>
      searchNovels(
        {
          word: displayTag,
          target: "exact_match_for_tags",
          sort,
        },
        token,
      ),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
  })

  const pixivisionFeed = usePixivFeed<PixivisionArticle>({
    enabled: kind === "pixivision",
    deps: [queryKey],
    publicEndpoint: true,
    fetcher: () => pixivisionByTag(queryKey, 1),
    fetchMore: (nextURL) => nextPixivision(nextURL),
  })

  const handleToggleBlock = useCallback(() => {
    try {
      triggerHaptic("selection")
    } catch {}
    if (blocked) {
      unblockTag(displayTag)
      overlay.showToast(`已取消屏蔽标签 #${displayTag}`, "success")
    } else {
      blockTag(displayTag)
      overlay.showToast(`已屏蔽标签 #${displayTag}`, "info")
    }
  }, [blocked, displayTag, overlay])

  const encyclopediaHeader =
    tagInfo && tagInfo.hasEncyclopedia ? (
      <View
        style={[
          styles.wikiCard,
          { backgroundColor: colors.surface, borderColor: colors.glassBorder },
        ]}
      >
        <View style={styles.wikiTop}>
          {tagInfo.thumbnailUrl ? (
            <PixImage url={tagInfo.thumbnailUrl} borderRadius={8} style={styles.wikiThumb} />
          ) : null}
          <View style={styles.flex}>
            <Text style={[styles.wikiLabel, { color: accent }]}>Pixiv 百科</Text>
            <Text style={[styles.wikiTitle, { color: colors.text }]} numberOfLines={1}>
              {tagInfo.tag || displayTag}
            </Text>
            {tagInfo.abstract ? (
              <Text
                style={[styles.wikiAbstract, { color: colors.textSecondary }]}
                numberOfLines={wikiExpanded ? undefined : 3}
              >
                {tagInfo.abstract}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.wikiFooter}>
          {tagInfo.abstract && tagInfo.abstract.length > 72 ? (
            <Pressable onPress={() => setWikiExpanded((v) => !v)} hitSlop={8}>
              <Text style={[styles.wikiLink, { color: accent }]}>
                {wikiExpanded ? "收起简介" : "展开简介"}
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          {tagInfo.dicUrl ? (
            <Pressable onPress={() => void openExternalUrl(tagInfo.dicUrl!)} hitSlop={8}>
              <Text style={[styles.wikiLink, { color: accent }]}>查看百科词条 ›</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    ) : null

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={`#${displayTag}`}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          <HeaderIconButton
            label={blocked ? "已屏蔽" : "屏蔽"}
            color={blocked ? colors.danger : colors.textSecondary}
            onPress={handleToggleBlock}
          />
        }
        bottom={
          <View style={styles.headerBottom}>
            <View style={styles.segWrap}>
              <SegmentedControl
                value={kind}
                onChange={setKind}
                options={[
                  { value: "illust", label: "插画" },
                  { value: "novel", label: "小说" },
                  { value: "pixivision", label: "特辑" },
                ]}
              />
            </View>
            {kind !== "pixivision" ? (
              <ChipBar
                compact={true}
                selected={sort}
                onSelect={setSort}
                items={[
                  { value: "date_desc", label: "最新" },
                  { value: "popular_desc", label: "热门" },
                  { value: "date_asc", label: "最早" },
                ]}
                trailing={
                  kind === "novel" ? (
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityLabel="仅看 8,000 字以上小说"
                      accessibilityState={{ checked: onlyLongNovel }}
                      onPress={() => {
                        try {
                          triggerHaptic("selection")
                        } catch {}
                        setOnlyLongNovel((v) => !v)
                      }}
                      style={[
                        styles.longNovelChip,
                        {
                          backgroundColor: onlyLongNovel ? accent : colors.fill,
                          borderColor: onlyLongNovel ? accent : colors.glassBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.longNovelChipText,
                          { color: onlyLongNovel ? "#FFFFFF" : colors.text },
                        ]}
                      >
                        {formatMinTextLengthLabel(NOVEL_LONG_FORM_MIN_TEXT_LENGTH)}
                      </Text>
                    </Pressable>
                  ) : undefined
                }
              />
            ) : null}
          </View>
        }
      />

      {kind === "illust" ? (
        <IllustMasonryFeed
          items={illustFeed.items}
          loading={illustFeed.loading}
          refreshing={illustFeed.refreshing}
          loadingMore={illustFeed.loadingMore}
          error={illustFeed.error}
          loadMoreError={illustFeed.loadMoreError}
          hasMore={illustFeed.hasMore}
          onRefresh={() => void illustFeed.refresh()}
          onLoadMore={() => void illustFeed.loadMore()}
          emptyTitle={`#${displayTag} 暂无插画`}
          ListHeaderComponent={encyclopediaHeader}
        />
      ) : kind === "novel" ? (
        <NovelFeedList
          items={novelFeed.items}
          loading={novelFeed.loading}
          refreshing={novelFeed.refreshing}
          loadingMore={novelFeed.loadingMore}
          error={novelFeed.error}
          loadMoreError={novelFeed.loadMoreError}
          hasMore={novelFeed.hasMore}
          onRefresh={() => void novelFeed.refresh()}
          onLoadMore={() => void novelFeed.loadMore()}
          emptyTitle={`#${displayTag} 暂无小说`}
          emptySubtitle={
            onlyLongNovel
              ? "已开启「≥8,000 字」过滤，再次点击顶部胶囊可关闭"
              : undefined
          }
          ListHeaderComponent={encyclopediaHeader}
        />
      ) : pixivisionFeed.loading && pixivisionFeed.items.length === 0 ? (
        <LoadingView message="正在搜索相关特辑…" />
      ) : pixivisionFeed.error && pixivisionFeed.items.length === 0 ? (
        <ErrorView message={pixivisionFeed.error} onRetry={() => void pixivisionFeed.refresh()} />
      ) : (
        <FlashList
          data={pixivisionFeed.items}
          estimatedItemSize={220}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: effectiveBottomInset(insets) + 32,
          }}
          refreshControl={
            <RefreshControl
              refreshing={pixivisionFeed.refreshing}
              onRefresh={() => void pixivisionFeed.refresh()}
              tintColor={accent}
              colors={[accent]}
            />
          }
          onEndReached={() => {
            if (pixivisionFeed.hasMore && !pixivisionFeed.loadingMore && !pixivisionFeed.loading) {
              void pixivisionFeed.loadMore()
            }
          }}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={encyclopediaHeader}
          ListEmptyComponent={<EmptyView title={`#${displayTag} 暂无相关特辑`} />}
          ListFooterComponent={
            pixivisionFeed.items.length > 0 ? (
              <InlineFooterLoader
                loading={pixivisionFeed.loadingMore}
                hasMore={pixivisionFeed.hasMore}
                error={pixivisionFeed.loadMoreError}
                onLoadMore={() => void pixivisionFeed.loadMore()}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => nav.push({ name: "pixivision", id: item.id, seed: item })}
              style={[
                styles.pvCard,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              <PixImage
                url={item.imageURL || item.thumbURL}
                resizeMode="cover"
                style={styles.pvCover}
              />
              <View style={styles.pvMeta}>
                <View style={styles.pvMetaTop}>
                  {item.category ? (
                    <View style={[styles.pvBadge, { backgroundColor: accentSoft }]}>
                      <Text style={[styles.pvBadgeText, { color: accent }]}>{item.category}</Text>
                    </View>
                  ) : null}
                  {item.date ? (
                    <Text style={[styles.pvDate, { color: colors.textTertiary }]}>{item.date}</Text>
                  ) : null}
                </View>
                <Text style={[styles.pvTitle, { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  headerBottom: {
    paddingBottom: 2,
  },
  segWrap: {
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  longNovelChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  longNovelChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  wikiCard: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  wikiTop: {
    flexDirection: "row",
    gap: 10,
  },
  wikiThumb: {
    width: 60,
    height: 60,
  },
  wikiLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  wikiTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginTop: 2,
  },
  wikiAbstract: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  wikiFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wikiLink: {
    fontSize: 12,
    fontWeight: "600",
  },
  pvCard: {
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  pvCover: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  pvMeta: {
    padding: 12,
    gap: 6,
  },
  pvMetaTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pvBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pvBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  pvDate: {
    fontSize: 11,
  },
  pvTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
})
