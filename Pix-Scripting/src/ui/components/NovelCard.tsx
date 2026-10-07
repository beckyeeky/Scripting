import {
  Button,
  FlowLayout,
  Group,
  HStack,
  Image,
  LongPressGesture,
  NavigationLink,
  ProgressView,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import { appGlass } from "./glass"
import { AppNavigationLink, useDualRoute } from "../DualRouteContext"
import { CachedImage } from "./CachedImage"
import { BookmarkButton, BookmarkDetailSheet } from "./BookmarkDetailSheet"
import { BlockWorkSheet } from "./BlockWorkSheet"
import { CORNER_ICON_SIZE, formatNumber, formatWordCount, type CardAction } from "./formatUtils"
import { useLatest, useNovelBookmark } from "../Hooks"
import { isUserFollowed, notifyUserFollowChanged } from "../../store/userFollow"
import { recordNovelMarker } from "../../store/bookmarkSync"
import { loadSettings } from "../../store/settings"
import { getSeriesByWorkID, recordWorkSeriesAssociation } from "../../store/seriesCache"
import {
  addNovelBookmark,
  bookmarkDetail,
  followUser,
  novelBookmarkDetail,
  novelBookmarkTags,
  novelViewerData,
  removeNovelBookmark,
} from "../../api/pixiv"
import { session } from "../../api/session"
import { exportNovelToEpub } from "../../downloader"
import { novelThumbUrlOf } from "../../image/imageLoader"
import { cacheNovel } from "../../store/novelCache"
import type { PixivNovel } from "../../types"
import { triggerHaptic } from "../../platform/haptics"
function NovelStatItem(props: {
  icon?: string
  text: string | number
  foregroundStyle?: any
  spacing?: number
}) {
  const { icon, text, foregroundStyle = "secondaryLabel", spacing = 4 } = props
  if (!icon) {
    return (
      <Text font="caption2" foregroundStyle={foregroundStyle} lineLimit={1}>
        {text}
      </Text>
    )
  }
  return (
    <HStack spacing={spacing}>
      <Image systemName={icon} font="caption2" foregroundStyle={foregroundStyle} />
      <Text font="caption2" foregroundStyle={foregroundStyle} lineLimit={1}>
        {text}
      </Text>
    </HStack>
  )
}

export function NovelCard(props: {
  novel: PixivNovel
  onAppear?: () => void
  priority?: number
  isSprint?: boolean
  footerText?: string
  markerPage?: number
  showEpisodeNumber?: boolean
  showSeriesTitle?: boolean
  topTrailingAction?: CardAction
  contextMenu?: any
}) {
  const {
    novel,
    onAppear,
    priority,
    isSprint,
    footerText,
    markerPage,
    showEpisodeNumber = true,
    showSeriesTitle = true,
    topTrailingAction,
    contextMenu,
  } = props

  if (markerPage != null && markerPage > 0) {
    recordNovelMarker(novel.id, markerPage)
  }

  cacheNovel(novel)

  const episodeNumber =
    novel.episode_number ??
    getSeriesByWorkID(novel.id, "novel")?.episodeNumber ??
    null

  const rawSeries = novel.series ?? (novel as any)?.novel_series
  const rawSeriesObj = Array.isArray(rawSeries) ? rawSeries[0] : rawSeries
  const associatedRef = getSeriesByWorkID(novel.id, "novel")
  const seriesTitle = rawSeriesObj?.title || associatedRef?.seriesTitle || null
  const seriesID = rawSeriesObj?.id ?? associatedRef?.seriesID ?? null

  if (seriesID && seriesTitle) {
    recordWorkSeriesAssociation(
      novel.id,
      "novel",
      seriesID,
      seriesTitle,
      episodeNumber
    )
  }

  const [bookmarked, setBookmarked] = useNovelBookmark(novel.id, novel.is_bookmarked)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const { isItemActive } = useDualRoute()
  const isSelected = isItemActive("novel", novel.id)
  const [isAppeared, setIsAppeared] = useState(false)

  const handleAppear = useCallback(() => {
    if (!isAppeared) setIsAppeared(true)
    onAppear?.()
  }, [isAppeared, onAppear])

  const effectivePriority = useMemo(() => {
    if (priority == null) return priority
    const enablePreemption = loadSettings().enableViewportPreemption ?? true
    if (enablePreemption && isAppeared) {
      return priority - 10000
    }
    return priority
  }, [priority, isAppeared])

  async function toggleNovelBookmark() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeNovelBookmark(novel.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
      }
    } catch {
      // 收藏失败时保持原状态
    } finally {
      setBookmarkBusy(false)
    }
  }

  function handleNovelBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    triggerHaptic("medium")
    if (action === "follow") {
      void bookmarkAndFollowNovel()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  async function bookmarkAndFollowNovel() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addNovelBookmark(novel.id, "public", token))
        setBookmarked(true)
      }
      const alreadyFollowed = isUserFollowed(novel.user.id) ?? novel.user.is_followed ?? false
      if (!alreadyFollowed) {
        await session.call((token) => followUser(novel.user.id, "public", token))
        notifyUserFollowChanged(novel.user.id, true, "public")
      }
    } catch {
      // 保持卡片可继续操作
    } finally {
      setBookmarkBusy(false)
    }
  }

  const coverURL =
    novel.image_urls?.medium ??
    novel.image_urls?.large ??
    novel.image_urls?.square_medium ??
    novel.cover?.urls?.["240mw"] ??
    novel.cover?.urls?.["480mw"] ??
    null

  const [followed, setFollowed] = useState(
    () => isUserFollowed(novel.user.id) ?? novel.user.is_followed ?? false
  )
  const [followBusy, setFollowBusy] = useState(false)
  const isOwnUser = session.userID === novel.user.id
  const [downloadingEpub, setDownloadingEpub] = useState(false)
  const [showBlockSheet, setShowBlockSheet] = useState(false)

  useEffect(() => {
    const next = isUserFollowed(novel.user.id) ?? novel.user.is_followed ?? false
    if (next !== followed) setFollowed(next)
  }, [novel.user.id, novel.user.is_followed])

  async function handleFollowUser() {
    if (followBusy || followed || isOwnUser) return
    triggerHaptic("medium")
    setFollowBusy(true)
    try {
      await session.call((token) => followUser(novel.user.id, "public", token))
      notifyUserFollowChanged(novel.user.id, true, "public")
      setFollowed(true)
    } catch {
      // 保持当前状态
    } finally {
      setFollowBusy(false)
    }
  }

  async function handleDownloadNovel() {
    if (downloadingEpub) return
    triggerHaptic("light")
    setDownloadingEpub(true)
    try {
      let fullText = ""
      const imagesMap: Record<string, string> = {}
      let cover = coverURL || undefined

      const viewer = await session.call((token) => novelViewerData(novel.id, token))
      if (viewer && viewer.text) {
        fullText = viewer.text
        if (viewer.coverUrl) cover = viewer.coverUrl
        if (viewer.textEmbeddedImages) {
          Object.entries(viewer.textEmbeddedImages).forEach(([key, imgObj]) => {
            const url =
              imgObj?.urls?.original ||
              imgObj?.urls?.["1200x1200"] ||
              imgObj?.urls?.["480mw"] ||
              (imgObj as any)?.urls?.large ||
              (imgObj as any)?.urls?.medium ||
              (imgObj as any)?.url
            if (url) {
              imagesMap[key] = url
              if (imgObj.novelImageId && imgObj.novelImageId !== key) {
                imagesMap[imgObj.novelImageId] = url
              }
            }
          })
        }
      }

      if (!fullText) return

      const isR18 = (novel.x_restrict ?? 0) > 0 || novel.tags?.some((t) => /r-?18/i.test(t.name))
      const filePath = await exportNovelToEpub({
        id: novel.id,
        title: novel.title,
        author: novel.user?.name || "Unknown",
        authorId: novel.user?.id,
        seriesTitle: seriesTitle ?? undefined,
        description: novel.caption,
        tags: novel.tags?.map((t) => t.name),
        createdDate: novel.create_date,
        isR18,
        coverUrl: cover,
        chapters: [
          {
            id: novel.id,
            title: novel.title,
            text: fullText,
            images: imagesMap,
            caption: novel.caption,
          },
        ],
      })

      if (filePath) {
        triggerHaptic("success")
        await ShareSheet.present([filePath])
      }
    } catch (e: any) {
      console.log("downloadNovel error:", e?.message ?? e)
    } finally {
      setDownloadingEpub(false)
    }
  }

  function handleShareNovel() {
    triggerHaptic("selection")
    const shareUrl = `https://www.pixiv.net/novel/show.php?id=${novel.id}`
    void ShareSheet.present([shareUrl])
  }

  const resolvedContextMenu = useMemo(() => {
    const defaultMenuItems = (
      <Group>
        <Button
          title={downloadingEpub ? "下载中…" : "下载小说"}
          systemImage={downloadingEpub ? "square.and.arrow.down.fill" : "square.and.arrow.down"}
          disabled={downloadingEpub}
          action={() => void handleDownloadNovel()}
        />
        {!followed && !isOwnUser && novel.user ? (
          <Button
            title={followBusy ? "关注中…" : "关注作者"}
            systemImage="person.badge.plus"
            disabled={followBusy}
            action={() => void handleFollowUser()}
          />
        ) : null}
        {seriesID ? (
          <NavigationLink value={`novelSeries:${seriesID}`}>
            <Button
              title="查看系列"
              systemImage="books.vertical"
              action={() => {}}
            />
          </NavigationLink>
        ) : null}
        <NavigationLink value={`relatedNovel:${novel.id}`}>
          <Button
            title="相关作品"
            systemImage="sparkles"
            action={() => {}}
          />
        </NavigationLink>
        <Button
          title="分享小说"
          systemImage="square.and.arrow.up"
          action={handleShareNovel}
        />
        <Button
          title="屏蔽设置"
          systemImage="nosign"
          role="destructive"
          action={() => {
            triggerHaptic("selection")
            setShowBlockSheet(true)
          }}
        />
      </Group>
    )

    if (!contextMenu) {
      return { menuItems: defaultMenuItems }
    }

    const customItems = contextMenu.menuItems ?? contextMenu
    if (contextMenu.override) {
      return {
        ...contextMenu,
        menuItems: customItems,
      }
    }

    return {
      ...contextMenu,
      menuItems: (
        <Group>
          {customItems}
          {defaultMenuItems}
        </Group>
      ),
    }
  }, [
    downloadingEpub,
    followed,
    isOwnUser,
    followBusy,
    novel.id,
    novel.user,
    novel.title,
    seriesID,
    contextMenu,
  ])

  return (
    <ZStack
      alignment="topTrailing"
      frame={{ maxWidth: "infinity" }}
      sheet={
        showBlockSheet
          ? {
              content: (
                <BlockWorkSheet
                  user={novel.user}
                  tags={novel.tags ?? []}
                  onClose={() => setShowBlockSheet(false)}
                />
              ),
              isPresented: showBlockSheet,
              onChanged: setShowBlockSheet,
            }
          : undefined
      }
    >
      <ZStack alignment="bottomTrailing" frame={{ maxWidth: "infinity" }}>
        <AppNavigationLink value={`novel:${novel.id}`} contextMenu={resolvedContextMenu}>
          <HStack
            spacing={6}
            padding={6}
            onAppear={handleAppear}
            alignment="top"
            glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
            shadow={
              isSelected
                ? { color: "accentColor", radius: 10, y: 0 }
                : { color: "#0000000F", radius: 18, y: 8 }
            }
            overlay={
              isSelected ? (
                <RoundedRectangle
                  cornerRadius={14}
                  stroke={{
                    shapeStyle: "accentColor",
                    strokeStyle: { lineWidth: 2.5 },
                  }}
                  frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                />
              ) : undefined
            }
            frame={{ maxWidth: "infinity" }}
          >
            <ZStack
              frame={{ width: 68, height: 96 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
            >
              <CachedImage
                url={coverURL}
                aspectRatioValue={0.71}
                centerCropAspect={0.71}
                cornerRadius={0}
                contentMode="fill"
                priority={effectivePriority}
                isSprint={isSprint || priority === 0}
                frame={{ width: 68, height: 96 }}
              />
            </ZStack>
            <VStack
              alignment="leading"
              spacing={4}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            >
              {showSeriesTitle && seriesTitle ? (
                <Text
                  font="caption2"
                  foregroundStyle="secondaryLabel"
                  lineLimit={1}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  {seriesTitle}
                </Text>
              ) : null}
              <Text
                font="subheadline"
                fontWeight="semibold"
                multilineTextAlignment="leading"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                {novel.title}
              </Text>
              <FlowLayout horizontalSpacing={4} verticalSpacing={2}>
                {novel.tags.map((tag) => (
                  <Text
                    key={tag.name}
                    font="caption2"
                    foregroundStyle="secondaryLabel"
                    lineLimit={1}
                  >
                    #{tag.name}
                  </Text>
                ))}
              </FlowLayout>
              <Spacer />
              <HStack frame={{ maxWidth: "infinity" }}>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {novel.user.name}
                </Text>
                <Spacer />
              </HStack>
              <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                <NovelStatItem icon="eye" text={formatNumber(novel.total_view)} />
                <NovelStatItem icon="heart" text={formatNumber(novel.total_bookmarks)} />
                {novel.text_length != null ? (
                  <NovelStatItem
                    icon="character.cursor.ibeam"
                    text={formatWordCount(novel.text_length)}
                  />
                ) : null}
                {showEpisodeNumber && episodeNumber != null ? (
                  <NovelStatItem text={`第${episodeNumber}话`} />
                ) : null}
                {markerPage != null && markerPage > 0 ? (
                  <NovelStatItem
                    icon="book.pages"
                    text={`第 ${markerPage} 页`}
                    foregroundStyle="systemBlue"
                    spacing={3}
                  />
                ) : null}
                {footerText ? <NovelStatItem text={footerText} /> : null}
                <Spacer />
              </HStack>
            </VStack>
          </HStack>
        </AppNavigationLink>
        <BookmarkButton
          size={30}
          bookmarked={bookmarked}
          disabled={bookmarkBusy}
          onTap={() => void toggleNovelBookmark()}
          onLongPress={handleNovelBookmarkLongPress}
          sheetContent={
            <BookmarkDetailSheet
              item={novel}
              bookmarked={bookmarked}
              loadDetail={(token) => novelBookmarkDetail(novel.id, token)}
              loadTags={(restrict, token) => novelBookmarkTags(restrict, token)}
              save={(restrict, tags, token) => addNovelBookmark(novel.id, restrict, token, tags)}
              onSaved={() => setBookmarked(true)}
              onClose={() => setShowBookmarkDetail(false)}
            />
          }
          sheetPresented={showBookmarkDetail}
          onSheetChanged={setShowBookmarkDetail}
        />
      </ZStack>
      {topTrailingAction ? (
        <Button
          buttonStyle="plain"
          action={topTrailingAction.action}
          frame={{ width: CORNER_ICON_SIZE, height: CORNER_ICON_SIZE }}
          glassEffect={appGlass("circle")}
          contentShape="circle"
          zIndex={1}
          offset={{ x: -4, y: 4 }}
        >
          <Image
            systemName={topTrailingAction.systemImage}
            font="body"
            tint={topTrailingAction.tint}
            foregroundStyle={topTrailingAction.foregroundStyle}
          />
        </Button>
      ) : null}
    </ZStack>
  )
}

