import React, { useCallback } from "react"
import { StyleSheet, View } from "react-native"
import {
  nextIllustrations,
  nextNovels,
  relatedIllustrations,
  relatedNovels,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import type { PixivIllustration, PixivNovel } from "../../../../../../Pix-Scripting/src/types"
import {
  IllustMasonryFeed,
  NovelFeedList,
  ScreenHeader,
  usePixivFeed,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useAppTheme } from "../../theme/ThemeProvider"

export function RelatedFeedScreen({
  kind,
  id,
}: {
  kind: "illust" | "novel"
  id: number
}) {
  const { colors } = useAppTheme()
  const nav = useAppNav()

  const illustFilter = useCallback(
    (items: PixivIllustration[]) => items.filter((it) => isIllustContentVisible(it)),
    [],
  )
  const novelFilter = useCallback(
    (items: PixivNovel[]) => items.filter((it) => isNovelContentVisible(it)),
    [],
  )

  const illustFeed = usePixivFeed<PixivIllustration>({
    enabled: kind === "illust",
    deps: [id],
    filter: illustFilter,
    fetcher: (token) => relatedIllustrations(id, token),
    fetchMore: (nextURL, token) => nextIllustrations(nextURL, token),
  })

  const novelFeed = usePixivFeed<PixivNovel>({
    enabled: kind === "novel",
    deps: [id],
    filter: novelFilter,
    fetcher: (token) => relatedNovels(id, token),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
  })

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={kind === "illust" ? "相关插画推荐" : "相关小说推荐"}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
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
          emptyTitle="暂无相关推荐插画"
        />
      ) : (
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
          emptyTitle="暂无相关推荐小说"
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
