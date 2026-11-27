import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StyleSheet, View } from "react-native"
import {
  fetchTagFilteredNovelsByUrl,
  fetchTagFilteredWorksByUrl,
  fetchUserTagFilteredNovels,
  fetchUserTagFilteredWorks,
  fetchUserWorkTags,
  nextIllustrations,
  nextNovels,
  userNovels,
  userWorks,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
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

type WorkKind = "illust" | "manga" | "novel"

export function UserWorksScreen({
  userId,
  title,
}: {
  userId?: number
  title?: string
}) {
  const { colors } = useAppTheme()
  const nav = useAppNav()

  const targetUid = userId ?? session.userID ?? 0
  const [kind, setKind] = useState<WorkKind>("illust")
  const [tags, setTags] = useState<PixivWebUserTag[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagGenRef = useRef(0)

  useEffect(() => {
    const gen = ++tagGenRef.current
    setSelectedTag(null)
    setTags([])
    if (targetUid <= 0) return

    void fetchUserWorkTags(targetUid, kind, 24)
      .then((res) => {
        if (gen === tagGenRef.current) setTags(res)
      })
      .catch(() => {
        if (gen === tagGenRef.current) setTags([])
      })
  }, [targetUid, kind])

  const illustFeed = usePixivFeed<PixivIllustration>({
    enabled: targetUid > 0 && kind !== "novel",
    deps: [targetUid, kind, selectedTag],
    fetcher: (token) => {
      const workType = kind === "manga" ? "manga" : "illust"
      if (selectedTag) {
        return fetchUserTagFilteredWorks(targetUid, workType, selectedTag, 0, 48)
      }
      return userWorks(targetUid, workType, token)
    },
    fetchMore: (nextURL, token) =>
      nextURL.startsWith("web-tag://")
        ? fetchTagFilteredWorksByUrl(nextURL)
        : nextIllustrations(nextURL, token),
  })

  const novelFeed = usePixivFeed<PixivNovel>({
    enabled: targetUid > 0 && kind === "novel",
    deps: [targetUid, kind, selectedTag],
    fetcher: (token) => {
      if (selectedTag) {
        return fetchUserTagFilteredNovels(targetUid, selectedTag, 0, 24)
      }
      return userNovels(targetUid, token)
    },
    fetchMore: (nextURL, token) =>
      nextURL.startsWith("web-tag://")
        ? fetchTagFilteredNovelsByUrl(nextURL)
        : nextNovels(nextURL, token),
  })

  const tagChips = useMemo<ChipItem<string>[]>(() => {
    if (tags.length === 0) return []
    return [
      { value: "__ALL__", label: "全部" },
      ...tags.map((t) => ({
        value: t.tag,
        label: t.tag_translation ? `${t.tag} · ${t.tag_translation}` : t.tag,
        badge: t.cnt > 0 ? t.cnt : undefined,
      })),
    ]
  }, [tags])

  const handleSelectTag = useCallback((val: string) => {
    setSelectedTag(val === "__ALL__" ? null : val)
  }, [])

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={title || (targetUid === session.userID ? "我的作品" : "用户作品")}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        bottom={
          <View style={styles.headerBottom}>
            <View style={styles.segWrap}>
              <SegmentedControl
                value={kind}
                onChange={setKind}
                options={[
                  { value: "illust", label: "插画" },
                  { value: "manga", label: "漫画" },
                  { value: "novel", label: "小说" },
                ]}
              />
            </View>
            {tagChips.length > 0 ? (
              <ChipBar
                compact={true}
                items={tagChips}
                selected={selectedTag ?? "__ALL__"}
                onSelect={handleSelectTag}
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
          emptyTitle="暂无小说作品"
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
          emptyTitle={kind === "manga" ? "暂无漫画作品" : "暂无插画作品"}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerBottom: {
    paddingBottom: 2,
  },
  segWrap: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
})
