import {
  Button,
  Group,
  LazyVStack,
  useCallback,
  useEffect,
  useMemo,
  useState,
  VStack,
} from "scripting"
import {
  loadPixivisionBookmarks,
  onPixivisionBookmarksChanged,
  preparePixivisionBookmarksStorage,
  removePixivisionBookmark,
  type PixivisionBookmarkItem,
} from "../store/pixivisionBookmarks"
import { EmptyView, PixivisionCard, RefreshableScrollView } from "./components"
import { loadSettings } from "../store/settings"
import { LibraryView } from "./LibraryView"
import { triggerHaptic } from "../platform/haptics"
import type { PixivisionArticle } from "../types"

const FLOW_HORIZONTAL_PADDING = 12

function bookmarkToArticle(item: PixivisionBookmarkItem): PixivisionArticle {
  return {
    id: item.id,
    title: item.title,
    imageURL: item.thumbnailURL || "",
    thumbURL: item.thumbnailURL,
    date: item.publishedAt || "",
    category: item.categoryLabel || item.category || "特辑",
    tags: item.tags?.map((name) => ({ id: 0, name })) ?? [],
  }
}

export function PixivisionBookmarksView() {
  return <LibraryView initialKind="pixivision" />
}

export function PixivisionBookmarksContent(props: {
  isAscending?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
}) {
  const [items, setItems] = useState<PixivisionBookmarkItem[]>(() => loadPixivisionBookmarks())
  const isAscending = props.isAscending ?? false

  useEffect(() => {
    void preparePixivisionBookmarksStorage().then(() => {
      setItems(loadPixivisionBookmarks())
    })
    return onPixivisionBookmarksChanged(() => {
      setItems(loadPixivisionBookmarks())
    })
  }, [])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const timeA = a.bookmarkedAt ?? 0
      const timeB = b.bookmarkedAt ?? 0
      return isAscending ? timeA - timeB : timeB - timeA
    })
  }, [items, isAscending])

  const firstImageUrl = useMemo(() => {
    return sortedItems[0]?.thumbnailURL ?? null
  }, [sortedItems])

  useEffect(() => {
    props.onFirstImageUrlChange?.(firstImageUrl)
  }, [firstImageUrl, props.onFirstImageUrlChange])

  const handleRefresh = useCallback(async () => {
    await preparePixivisionBookmarksStorage()
    setItems(loadPixivisionBookmarks())
  }, [])

  return (
    <RefreshableScrollView refreshable={handleRefresh}>
      <VStack
        alignment="leading"
        spacing={8}
        padding={{
          horizontal: FLOW_HORIZONTAL_PADDING,
          bottom: Math.round(loadSettings().feedBottomInset / 2),
        }}
      >
        {sortedItems.length === 0 ? (
          <EmptyView
            text="暂无收藏的特辑"
            systemImage="rectangle.stack"
          />
        ) : (
          <LazyVStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            {sortedItems.map((item, index) => (
              <PixivisionCard
                key={item.id}
                article={bookmarkToArticle(item)}
                priority={index}
                contextMenu={{
                  menuItems: (
                    <Group>
                      <Button
                        title="取消收藏"
                        systemImage="heart.slash"
                        role="destructive"
                        action={() => {
                          try {
                            triggerHaptic("medium")
                          } catch {}
                          removePixivisionBookmark(item.id)
                        }}
                      />
                    </Group>
                  ),
                }}
              />
            ))}
          </LazyVStack>
        )}
      </VStack>
    </RefreshableScrollView>
  )
}
