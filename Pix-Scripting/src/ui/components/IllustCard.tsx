import {
  Button,
  Device,
  Group,
  HStack,
  Image,
  NavigationLink,
  RoundedRectangle,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { AppNavigationLink, useDualRoute } from "../DualRouteContext"
import { CachedImage, PageCountBadge } from "./CachedImage"
import { BookmarkButton, BookmarkDetailSheet } from "./BookmarkDetailSheet"
import { BlockWorkSheet } from "./BlockWorkSheet"
import { appGlass } from "./glass"
import { CORNER_ICON_SIZE, formatNumber, type CardAction } from "./formatUtils"
import { useIllustBookmark, useUserFollow } from "../Hooks"
import { isUserFollowed, notifyUserFollowChanged } from "../../store/userFollow"
import { cacheIllust } from "../../store/illustCache"
import { loadSettings, getDownloadImageQuality, onSettingsChanged } from "../../store/settings"
import { downloadIllustToAlbum, exportUgoiraToAlbum } from "../../downloader"
import { addBookmark, bookmarkDetail, bookmarkTags, followUser, removeBookmark } from "../../api/pixiv"
import { session } from "../../api/session"
import { cardThumbUrlOf, heroCardThumbUrlOf } from "../../image/imageLoader"
import type { PixivIllustration } from "../../types"
import { triggerHaptic } from "../../platform/haptics"

export const FLOW_HORIZONTAL_PADDING = 12
export const FLOW_COLUMN_SPACING = 12
export const FLOW_ROW_SPACING = 4

export function calculateFlowCardWidth(
  containerWidth: number = Device.screen.width,
  columnCount: number = 2
): number {
  const count = Math.max(1, columnCount)
  const totalSpacing = (count - 1) * FLOW_COLUMN_SPACING
  return Math.floor(
    (containerWidth - FLOW_HORIZONTAL_PADDING * 2 - totalSpacing) / count
  )
}

export function calculateHeroCardWidth(containerWidth: number = Device.screen.width): number {
  return Math.floor(containerWidth - FLOW_HORIZONTAL_PADDING * 2)
}

// 流式布局允许最长 1:3 的竖图保留原始比例；更极端的超长竖图受此下限保护并启用顶部等比无损裁切。
export const MIN_FLOW_IMAGE_RATIO = 1 / 3

export type IllustCardAction = CardAction

function IllustStatItem(props: { icon: string; count: number; hero?: boolean }) {
  const { icon, count, hero } = props
  const style = hero ? "subheadline" : "caption2"
  return (
    <HStack spacing={hero ? 3 : 2} fixedSize={{ horizontal: true, vertical: false }}>
      <Image
        systemName={icon}
        font={style}
        foregroundStyle="secondaryLabel"
      />
      <Text
        font={style}
        foregroundStyle="secondaryLabel"
        lineLimit={1}
        fixedSize={{ horizontal: true, vertical: false }}
      >
        {formatNumber(count)}
      </Text>
    </HStack>
  )
}


export function IllustCard(props: {
  illust: PixivIllustration
  onAppear?: () => void
  flow?: boolean
  hero?: boolean
  compact?: boolean
  cardWidth?: number
  showBookmarkButton?: boolean
  priority?: number
  isSprint?: boolean
  cornerBadge?: any
  footerText?: string
  topTrailingAction?: IllustCardAction
  contextMenu?: any
}) {
  const {
    illust,
    onAppear,
    flow = false,
    hero = false,
    compact,
    cardWidth,
    showBookmarkButton = true,
    priority,
    isSprint,
    cornerBadge,
    footerText,
    topTrailingAction,
    contextMenu,
  } = props
  cacheIllust(illust)
  const [bookmarked, setBookmarked] = useIllustBookmark(illust.id, illust.is_bookmarked)
  const [followed, setFollowed] = useUserFollow(illust.user?.id ?? 0, illust.user?.is_followed ?? false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [showBookmarkDetail, setShowBookmarkDetail] = useState(false)
  const [showBlockSheet, setShowBlockSheet] = useState(false)
  const { isItemActive } = useDualRoute()
  const isSelected = isItemActive("illust", illust.id)
  const [downloading, setDownloading] = useState(false)
  const [compactSetting, setCompactSetting] = useState(() => loadSettings().compactIllustCard)

  useEffect(() => {
    return onSettingsChanged(() => {
      setCompactSetting(loadSettings().compactIllustCard)
    })
  }, [])

  const isCompact = compact ?? compactSetting
  const isFirstCard = hero || priority === 0 || Boolean(isSprint)
  // 流式或Hero普通卡片只在进入原生可见区后请求图片；首图或高优先级冲刺卡片第 0 帧直接就绪发车。
  const [imageVisible, setImageVisible] = useState(!flow && !hero || isFirstCard)
  const [isAppeared, setIsAppeared] = useState(!flow && !hero || isFirstCard)
  const isHeroOrFirst = hero || (priority === 0 && (isAppeared || flow))
  const isSprintCard = isSprint ?? isHeroOrFirst
  const rawRatio = illust.width > 0 && illust.height > 0 ? illust.width / illust.height : 0.75
  const isExtremeTall = (flow || hero) && rawRatio < MIN_FLOW_IMAGE_RATIO

  let imageRatio = 1
  let imageFrame: { width?: number; height?: number } | undefined = undefined
  let cardFrame: { width?: number; maxWidth?: string } = { maxWidth: "infinity" }

  const computedCardWidth = cardWidth ?? (hero ? calculateHeroCardWidth() : calculateFlowCardWidth())

  if (hero) {
    cardFrame = { width: computedCardWidth }
    imageRatio = Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO)
    imageFrame = { width: computedCardWidth, height: computedCardWidth / imageRatio }
  } else if (flow) {
    cardFrame = { width: computedCardWidth }
    imageRatio = Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO)
    imageFrame = { width: computedCardWidth, height: computedCardWidth / imageRatio }
  }

  function handleAppear() {
    if (!imageVisible) setImageVisible(true)
    if (!isAppeared) setIsAppeared(true)
    onAppear?.()
  }

  const effectivePriority = useMemo(() => {
    if (priority == null) return priority
    const enablePreemption = loadSettings().enableViewportPreemption ?? true
    if (enablePreemption && isAppeared) {
      return priority - 10000
    }
    return priority
  }, [priority, isAppeared])

  async function toggleBookmark() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarked) {
        await session.call((token) => removeBookmark(illust.id, token))
        setBookmarked(false)
      } else {
        await session.call((token) => addBookmark(illust.id, "public", [], token))
        setBookmarked(true)
      }
    } catch {
      // 收藏失败时保持原状态
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function bookmarkAndFollow() {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (!bookmarked) {
        await session.call((token) => addBookmark(illust.id, "public", [], token))
        setBookmarked(true)
      }
      const alreadyFollowed = isUserFollowed(illust.user.id) ?? illust.user.is_followed ?? false
      if (!alreadyFollowed) {
        await session.call((token) => followUser(illust.user.id, "public", token))
        notifyUserFollowChanged(illust.user.id, true, "public")
      }
    } catch {
      // 保持卡片可继续操作
    } finally {
      setBookmarkBusy(false)
    }
  }

  function handleBookmarkLongPress() {
    const action = loadSettings().longPressBookmarkAction
    if (action === "off") return
    triggerHaptic("medium")
    if (action === "follow") {
      void bookmarkAndFollow()
    } else {
      setShowBookmarkDetail(true)
    }
  }

  const handleDownload = useCallback(async () => {
    if (downloading) return
    triggerHaptic("light")
    setDownloading(true)
    try {
      if (illust.type === "ugoira") {
        const res = await exportUgoiraToAlbum(illust)
        if (res.success) {
          triggerHaptic("success")
        }
      } else {
        const quality = getDownloadImageQuality()
        const ok = await downloadIllustToAlbum(illust, quality)
        if (ok) {
          triggerHaptic("success")
        }
      }
    } catch (err: any) {
      console.log("IllustCard download error:", err?.message ?? err)
    } finally {
      setDownloading(false)
    }
  }, [illust, downloading])

  const isOwnUser = Boolean(
    session.userID && illust.user && String(illust.user.id) === String(session.userID)
  )

  const handleFollowUser = useCallback(async () => {
    if (!illust.user || followed || followBusy) return
    setFollowBusy(true)
    triggerHaptic("light")
    try {
      await session.call((token) => followUser(illust.user.id, "public", token))
      setFollowed(true)
      triggerHaptic("success")
    } catch (err: any) {
      console.log("IllustCard followUser error:", err?.message ?? err)
    } finally {
      setFollowBusy(false)
    }
  }, [illust.user, followed, followBusy, setFollowed])

  const resolvedContextMenu = useMemo(
    () =>
      renderIllustContextMenu(
        illust,
        downloading,
        handleDownload,
        followed,
        isOwnUser,
        followBusy,
        handleFollowUser,
        () => setShowBlockSheet(true),
        contextMenu
      ),
    [
      illust,
      downloading,
      handleDownload,
      followed,
      isOwnUser,
      followBusy,
      handleFollowUser,
      contextMenu,
    ]
  )

  return (
    <ZStack
      alignment="topTrailing"
      frame={cardFrame}
      sheet={
        showBlockSheet
          ? {
              content: (
                <BlockWorkSheet
                  user={illust.user}
                  tags={illust.tags ?? []}
                  onClose={() => setShowBlockSheet(false)}
                />
              ),
              isPresented: showBlockSheet,
              onChanged: setShowBlockSheet,
            }
          : undefined
      }
    >
      <VStack
        alignment="leading"
        spacing={isCompact ? 0 : (hero ? 4 : 2)}
        frame={cardFrame}
        onAppear={handleAppear}
        padding={4}
        glassEffect={appGlass({ type: "rect", cornerRadius: hero ? 16 : 14 })}
        shadow={
          isSelected
            ? { color: "accentColor", radius: 10, y: 0 }
            : { color: "#0000000F", radius: hero ? 20 : 18, y: hero ? 10 : 8 }
        }
        overlay={
          isSelected ? (
            // 分栏下的选中指示器（仅 canSplit 时 isSelected 才可能为 true）。
            // 环必须用 maxWidth/maxHeight: infinity 撑满「卡片外层」，**不能**复用 cardFrame：
            // cardFrame 是「内容层」宽度（图片那一层用的同一个数值），会让环被卡片 padding 内缩，
            // 表现为「没框住卡片」。写法与 NovelCard / WatchlistSeriesCard 保持一致。
            <RoundedRectangle
              cornerRadius={hero ? 16 : 14}
              stroke={{
                shapeStyle: "accentColor",
                strokeStyle: { lineWidth: 2.5 },
              }}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            />
          ) : undefined
        }
      >
        <ZStack alignment="bottomTrailing" frame={cardFrame}>
          <AppNavigationLink
            value={`illust:${illust.id}`}
            frame={cardFrame}
            contextMenu={resolvedContextMenu}
          >
            <ZStack alignment="topLeading" frame={cardFrame}>
              <ZStack
                alignment="bottomLeading"
                aspectRatio={flow || hero ? undefined : { value: 1, contentMode: "fill" }}
                frame={imageFrame ?? { maxWidth: "infinity" }}
                clipShape={{ type: "rect", cornerRadius: hero ? 12 : 10 }}
                clipped={true}
              >
                <CachedImage
                  url={
                    imageVisible
                      ? hero
                        ? heroCardThumbUrlOf(illust)
                        : cardThumbUrlOf(illust)
                      : null
                  }
                  previewUrl={hero ? cardThumbUrlOf(illust, "medium") : undefined}
                  aspectRatioValue={flow || hero ? imageRatio : 1}
                  contentMode={flow || hero ? (isExtremeTall ? "fill" : "fit") : "fill"}
                  centerCropAspect={isExtremeTall ? MIN_FLOW_IMAGE_RATIO : undefined}
                  cropAnchor={isExtremeTall ? "top" : "center"}
                  centerCropSquare={!flow && !hero}
                  cornerRadius={hero ? 12 : 10}
                  frame={imageFrame}
                  priority={effectivePriority}
                  isSprint={isSprintCard}
                />
                {illust.page_count > 1 ? (
                  <PageCountBadge count={illust.page_count} hero={hero} />
                ) : null}
              </ZStack>
              {cornerBadge ?? null}
            </ZStack>
          </AppNavigationLink>
          {showBookmarkButton ? (
            <BookmarkButton
              hero={hero}
              bookmarked={bookmarked}
              disabled={bookmarkBusy}
              onTap={toggleBookmark}
              onLongPress={handleBookmarkLongPress}
              sheetContent={
                <BookmarkDetailSheet
                  item={illust}
                  bookmarked={bookmarked}
                  loadDetail={(token) => bookmarkDetail(illust.id, token)}
                  loadTags={(restrict, token) => bookmarkTags(session.userID ?? 0, restrict, token)}
                  save={(restrict, tags, token) =>
                    addBookmark(illust.id, restrict, tags, token)
                  }
                  onSaved={() => setBookmarked(true)}
                  onClose={() => setShowBookmarkDetail(false)}
                />
              }
              sheetPresented={showBookmarkDetail}
              onSheetChanged={setShowBookmarkDetail}
            />
          ) : null}
        </ZStack>
        {!isCompact ? (
          <>
            <AppNavigationLink
              value={`illust:${illust.id}`}
              contextMenu={resolvedContextMenu}
            >
              <Text
                font={hero ? "headline" : "caption"}
                fontWeight={hero ? "bold" : "medium"}
                lineLimit={hero ? 2 : 1}
                padding={{ horizontal: hero ? 6 : 4, top: hero ? 4 : 2 }}
              >
                {illust.title}
              </Text>
            </AppNavigationLink>
            <HStack
              spacing={hero ? 8 : 5}
              padding={{ horizontal: hero ? 6 : 4, bottom: footerText ? 0 : (hero ? 6 : 4) }}
              frame={{ maxWidth: "infinity" }}
            >
              <AppNavigationLink
                value={`illust:${illust.id}`}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                contextMenu={resolvedContextMenu}
              >
                <Text
                  font={hero ? "subheadline" : "caption2"}
                  foregroundStyle="secondaryLabel"
                  lineLimit={1}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  {illust.user.name}
                </Text>
              </AppNavigationLink>
              <HStack
                spacing={hero ? 8 : 5}
                fixedSize={{ horizontal: true, vertical: false }}
                layoutPriority={1}
                frame={{ alignment: "trailing" }}
              >
                <IllustStatItem icon="eye" count={illust.total_view} hero={hero} />
                <IllustStatItem icon="heart" count={illust.total_bookmarks} hero={hero} />
              </HStack>
            </HStack>
            {footerText ? (
              <Text
                font={hero ? "footnote" : "caption2"}
                foregroundStyle="secondaryLabel"
                lineLimit={1}
                padding={{ horizontal: hero ? 6 : 4, bottom: hero ? 6 : 4 }}
              >
                {footerText}
              </Text>
            ) : null}
          </>
        ) : null}
      </VStack>
      {topTrailingAction ? (
        <Button
          buttonStyle="plain"
          action={topTrailingAction.action}
          frame={{
            width: hero ? 30 : CORNER_ICON_SIZE,
            height: hero ? 30 : CORNER_ICON_SIZE,
          }}
          glassEffect={appGlass("circle")}
          contentShape="circle"
          zIndex={1}
          offset={hero ? { x: -5, y: 5 } : { x: -4, y: 4 }}
        >
          <Image
            systemName={topTrailingAction.systemImage}
            font={hero ? "title3" : "body"}
            tint={topTrailingAction.tint}
            foregroundStyle={topTrailingAction.foregroundStyle}
          />
        </Button>
      ) : null}
    </ZStack>
  )
}

export {
  IllustFlowFeed,
  type IllustFlowFeedProps,
  type IllustFlowItem,
} from "./IllustFlowFeed"


function renderIllustContextMenu(
  illust: PixivIllustration,
  downloading: boolean,
  onDownload: () => void,
  followed: boolean,
  isOwnUser: boolean,
  followBusy: boolean,
  onFollowUser: () => void,
  onOpenBlockSheet: () => void,
  customContextMenu?: any
) {
  const pageCount = illust.page_count ?? 1
  const ugoiraFormat = loadSettings().ugoiraExportFormat ?? "mp4"
  const downloadTitle =
    illust.type === "ugoira"
      ? `下载动图 (${ugoiraFormat.toUpperCase()})`
      : pageCount > 1
        ? `下载全部图片 (共 ${pageCount} 张)`
        : "下载图片"

  const downloadIcon =
    illust.type === "ugoira"
      ? ugoiraFormat === "gif"
        ? "photo.stack"
        : "film"
      : downloading
        ? "square.and.arrow.down.fill"
        : "square.and.arrow.down"

  const defaultMenuItems = (
    <Group>
      <Button
        title={downloading ? "下载中…" : downloadTitle}
        systemImage={downloadIcon}
        disabled={downloading}
        action={onDownload}
      />
      {!followed && !isOwnUser && illust.user ? (
        <Button
          title={followBusy ? "关注中…" : "关注作者"}
          systemImage="person.badge.plus"
          disabled={followBusy}
          action={onFollowUser}
        />
      ) : null}
      <NavigationLink value={`relatedIllust:${illust.id}`}>
        <Button
          title="相关作品"
          systemImage="sparkles"
          action={() => {}}
        />
      </NavigationLink>
      <Button
        title="屏蔽设置"
        systemImage="nosign"
        role="destructive"
        action={onOpenBlockSheet}
      />
    </Group>
  )

  if (!customContextMenu) {
    return { menuItems: defaultMenuItems }
  }

  const customItems = customContextMenu.menuItems ?? customContextMenu
  if (customContextMenu.override) {
    return {
      ...customContextMenu,
      menuItems: customItems,
    }
  }

  return {
    ...customContextMenu,
    menuItems: (
      <Group>
        {customItems}
        {defaultMenuItems}
      </Group>
    ),
  }
}
