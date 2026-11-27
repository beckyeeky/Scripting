import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StyleSheet, View } from "react-native"
import {
  fetchUserBookmarkTags,
  nextIllustrations,
  nextNovels,
  userBookmarks,
  userNovelBookmarks,
  type Visibility,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import type {
  PixivIllustration,
  PixivNovel,
  PixivWebUserTag,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ChipBar,
  IllustMasonryFeed,
  NovelFeedList,
  ScreenHeader,
  SegmentedControl,
  usePixivFeed,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useAppTheme } from "../../theme/ThemeProvider"

export function UserBookmarksScreen({ userId }: { userId: number }) {
  const { colors } = useAppTheme()
  const nav = useAppNav()

  const isSelf = userId === session.userID
  const [kind, setKind] = useState<"illust" | "novel">("illust")
  const [restrict, setRestrict] = useState<Visibility>("public")
  const [tags, setTags] = useState<PixivWebUserTag[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagGenRef = useRef(0)

  useEffect(() => {
    const gen = ++tagGenRef.current
    setSelectedTag(null)
    setTags([])
    if (userId <= 0) return

    void fetchUserBookmarkTags(userId, kind, 24, isSelf ? restrict : "public")
      .then((res) => {
        if (gen === tagGenRef.current) setTags(res)
      })
      .catch(() => {
        if (gen === tagGenRef.current) setTags([])
      })
  }, [userId, kind, restrict, isSelf])

  const illustFilter = useCallback(
    (items: PixivIllustration[]) =>
      items.filter((it) => isIllustContentVisible(it, undefined, undefined, { exemptRestrictions: isSelf })),
    [isSelf],
  )

  const novelFilter = useCallback(
    (items: PixivNovel[]) =>
      items.filter((it) => isNovelContentVisible(it, undefined, undefined, { exemptRestrictions: isSelf })),
    [isSelf],
  )

  const illustFeed = usePixivFeed<PixivIllustration>({
    enabled: userId > 0 && kind === "illust",
    deps: [userId, kind, restrict, selectedTag],
    filter: illustFilter,
    fetcher: (token) => userBookmarks(userId, isSelf ? restrict : "public", token, selectedTag),
    fetchMore: (nextURL, token) => nextIllustrations(nextURL, token),
  })

  const novelFeed = usePixivFeed<PixivNovel>({
    enabled: userId > 0 && kind === "novel",
    deps: [userId, kind, restrict, selectedTag],
    filter: novelFilter,
    fetcher: (token) => userNovelBookmarks(userId, isSelf ? restrict : "public", selectedTag, token),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
  })

  const tagChips = useMemo<ChipItem<string>[]>(() => {
    if (tags.length === 0) return []
    return [
      { value: "__ALL__", label: "全部" },
      ...tags.map((t) => ({
        value: t.tag,
        label: t.tag,
        badge: t.cnt > 0 ? t.cnt : undefined,
      })),
    ]
  }, [tags])

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={isSelf ? "我的收藏" : "用户收藏"}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        bottom={
          <View style={styles.headerBottom}>
            <View style={styles.controlsRow}>
              <View style={styles.flex}>
                <SegmentedControl
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "illust", label: "插画" },
                    { value: "novel", label: "小说" },
                  ]}
                />
              </View>
              {isSelf ? (
                <View style={styles.restrictWrap}>
                  <SegmentedControl
                    value={restrict}
                    onChange={setRestrict}
                    options={[
                      { value: "public", label: "公开" },
                      { value: "private", label: "私密" },
                    ]}
                  />
                </View>
              ) : null}
            </View>
            {tagChips.length > 0 ? (
              <ChipBar
                compact={true}
                items={tagChips}
                selected={selectedTag ?? "__ALL__"}
                onSelect={(v) => setSelectedTag(v === "__ALL__" ? null : v)}
              />
            ) : null}
          </View>
        }
      />

      {kind === "novel" ? (
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
          emptyTitle="暂无收藏小说"
        />
      ) : (
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
          emptyTitle="暂无收藏插画"
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
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 8,
    gap: 8,
  },
  restrictWrap: {
    width: 124,
  },
})
