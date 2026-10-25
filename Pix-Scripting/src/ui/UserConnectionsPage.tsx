import {
  Button,
  Device,
  GeometryReader,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import { useDualRoute } from "./DualRouteContext"
import {
  myPixivUsers,
  nextUsers,
  recommendedUsers,
  userConnections,
  type Visibility,
} from "../api/pixiv"
import { session } from "../api/session"
import { loadSettings, onSettingsChanged } from "../store/settings"
import type { PixivUserPreview } from "../types"
import {
  ConnectionRow,
  connectionPreviewImageURLs,
  CONNECTION_CARD_HORIZONTAL_PADDING,
  CONNECTION_LIST_HORIZONTAL_PADDING,
  CONNECTION_PREVIEW_GAP,
  EmptyView,
  ErrorView,
  LoadMoreTrigger,
  LoadingView,
  RefreshableScrollView,
} from "./components"
import { prefetch } from "../image/imageLoader"
import { currentBatchSize, usePagedList, useLayoutMetrics, IPAD_WIDE_MIN_WIDTH } from "./Hooks"
import { useExperimentalAmbientPalette, getLastActiveAmbientImageUrl, recordActiveAmbientImageUrl } from "./ambient"
import {
  DockActionBar,
  useRegisterBottomAccessory,
  type DockActionItem,
} from "./bottomAccessory"
import { triggerHaptic } from "../platform/haptics"

export type ConnectionRouteKind = "following" | "follower" | "mypixiv"
export type ConnectionVisibility = Extract<Visibility, "public" | "private">
export type FollowingTab = "public" | "private" | "recommended"

export type ConnectionPreview = PixivUserPreview & { id: number }

const TITLES: Record<ConnectionRouteKind, string> = {
  following: "我的关注",
  follower: "我的粉丝",
  mypixiv: "我的好友",
}

export function UserConnectionsView(props: {
  kind: ConnectionRouteKind
  userID?: number
  title?: string
  showVisibilityPicker?: boolean
}) {
  const userID = props.userID ?? session.userID
  const title =
    props.title ??
    (props.userID == null
      ? TITLES[props.kind]
      : props.kind === "following"
        ? "关注"
        : props.kind === "follower"
          ? "粉丝"
          : "好友")

  const isMyFollowing = props.kind === "following" && (props.userID == null || props.userID === session.userID)
  const [followingTab, setFollowingTab] = useState<FollowingTab>("public")
  const [visitedTabs, setVisitedTabs] = useState<Set<FollowingTab>>(() => new Set([followingTab]))
  const [restrict, setRestrict] = useState<ConnectionVisibility>("public")

  const [hideNovels, setHideNovels] = useState(() => loadSettings().hideNovels)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"

  // 记录各分类第一张封面图，用于在多容器切换时平滑承接环境光
  const firstImageUrlsRef = useRef<Record<string, string | null>>({})
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(() => getLastActiveAmbientImageUrl())
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  const showVisibilityPicker = props.showVisibilityPicker ?? isMyFollowing
  const { isSplitViewActive } = useDualRoute()
  const layoutMetrics = useLayoutMetrics()
  const isFullScreenPad =
    Device.isiPad &&
    !isSplitViewActive &&
    layoutMetrics.width >= IPAD_WIDE_MIN_WIDTH

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings()
      setHideNovels(next.hideNovels)
      setPageLayout(next.pageLayout)
    })
  }, [])

  // 切换我的关注 Tab：更新已访问集合并切到对应容器，零网络重载且保留各自的滚动位置
  const selectFollowingTab = useCallback((tab: FollowingTab) => {
    try {
      triggerHaptic("selection")
    } catch {}
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
    setFollowingTab(tab)
    const cachedUrl = firstImageUrlsRef.current[tab]
    if (cachedUrl) {
      setAmbientImageUrl(cachedUrl)
      recordActiveAmbientImageUrl(cachedUrl)
    }
  }, [])

  // 底部苹果音乐配件栏：严格绑定唯一专属 Key，绝不污染非我的关注页面
  const myFollowingAccessory = useMemo(() => {
    if (!isMyFollowing) return null
    const items: DockActionItem[] = [
      {
        key: "public",
        label: "公开",
        icon: "globe",
        color: followingTab === "public" ? "systemPink" : "systemBlue",
        action: () => selectFollowingTab("public"),
      },
      {
        key: "private",
        label: "私密",
        icon: "lock",
        color: followingTab === "private" ? "systemPink" : "systemBlue",
        action: () => selectFollowingTab("private"),
      },
      {
        key: "recommended",
        label: "推荐",
        icon: "sparkles",
        color: followingTab === "recommended" ? "systemPink" : "systemBlue",
        action: () => selectFollowingTab("recommended"),
      },
    ]
    return <DockActionBar items={items} />
  }, [isMyFollowing, followingTab, selectFollowingTab])

  // 注册底栏配件：只有我的关注使用 connections:following 且仅在启用时生效；非关注流使用独立命名空间杜绝冲刷
  const accessoryKey = isMyFollowing
    ? "connections:following"
    : `connections:${props.kind}:${userID ?? 0}`

  useRegisterBottomAccessory(
    accessoryKey,
    myFollowingAccessory,
    isAppleMusic && isMyFollowing
  )

  // 刷新句柄引用：分别维护各独立分类的下拉刷新实现
  const publicRefreshRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const privateRefreshRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const recommendedRefreshRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const genericRefreshRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const handleActiveRefresh = useCallback(() => {
    if (isMyFollowing) {
      if (followingTab === "public") return publicRefreshRef.current()
      if (followingTab === "private") return privateRefreshRef.current()
      return recommendedRefreshRef.current()
    }
    return genericRefreshRef.current()
  }, [isMyFollowing, followingTab])

  // 标题与副标题计算
  const currentSubLabel = isMyFollowing
    ? followingTab === "public"
      ? "公开"
      : followingTab === "private"
        ? "私密"
        : "推荐"
    : props.kind === "following"
      ? restrict === "public"
        ? "公开"
        : "私密"
      : undefined

  const navTitle = isAppleMusic
    ? title
    : currentSubLabel
      ? `${title} · ${currentSubLabel}`
      : title

  // 顶栏右侧菜单（完全遵循我的收藏页设计规范：仅在 iPad 宽屏全屏模式下展开文本胶囊，其余场景统一收起为优雅的「三个点」ellipsis.circle）
  const trailingMenu = useMemo(() => {
    const renderMenuLabel = (text: string) =>
      isFullScreenPad ? (
        <HStack alignment="center" spacing={4}>
          <Text font="subheadline" fontWeight="semibold">
            {text}
          </Text>
          <Image
            systemName="chevron.down"
            font="caption2"
            foregroundStyle="secondaryLabel"
          />
        </HStack>
      ) : (
        <Image systemName="ellipsis.circle" />
      )

    if (isMyFollowing) {
      return (
        <Menu
          key="my-following-menu"
          label={renderMenuLabel(currentSubLabel ?? "公开")}
        >
          <Picker
            title="关注分类"
            value={followingTab}
            onChanged={(value: string) => selectFollowingTab(value as FollowingTab)}
          >
            <Label tag="public" title="公开关注" systemImage="globe" />
            <Label tag="private" title="私密关注" systemImage="lock" />
            <Label tag="recommended" title="推荐创作者" systemImage="sparkles" />
          </Picker>
        </Menu>
      )
    }

    if (showVisibilityPicker) {
      return (
        <Menu
          key="other-following-menu"
          label={renderMenuLabel(restrict === "public" ? "公开" : "私密")}
        >
          <Picker
            title="关注范围"
            value={restrict}
            onChanged={(value: string) => setRestrict(value as ConnectionVisibility)}
          >
            <Label tag="public" title="公开" systemImage="globe" />
            <Label tag="private" title="私密" systemImage="lock" />
          </Picker>
        </Menu>
      )
    }

    return null
  }, [
    isMyFollowing,
    showVisibilityPicker,
    followingTab,
    restrict,
    currentSubLabel,
    isFullScreenPad,
    selectFollowingTab,
  ])

  return (
    <GeometryReader>
      {(proxy) => {
        const previewSide = Math.max(
          0,
          (proxy.size.width -
            (CONNECTION_LIST_HORIZONTAL_PADDING + CONNECTION_CARD_HORIZONTAL_PADDING) * 2 -
            CONNECTION_PREVIEW_GAP * 2) / 3
        )

        // 统一顶栏配置
        const toolbarConfig = {
          principal: isFullScreenPad ? undefined : (
            <Text font="title2" fontWeight="bold">
              {title}
            </Text>
          ),
          topBarTrailing: trailingMenu ? [trailingMenu] : undefined,
        }

        // 场景 A：我的关注（三分类层叠保活架构，支持公开/私密/推荐毫秒级秒切与原生滚动位置记忆）
        if (isMyFollowing) {
          return (
            <ZStack
              navigationTitle={navTitle}
              navigationBarTitleDisplayMode="inline"
              background={ambientBackground}
              toolbar={toolbarConfig}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            >
              {/* 1. 公开关注列表保活容器（槽位 0） */}
              <VStack
                key="slot-following-public"
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                opacity={followingTab === "public" ? 1 : 0}
                zIndex={followingTab === "public" ? 1 : 0}
                allowsHitTesting={followingTab === "public"}
              >
                <RefreshableScrollView
                  key="scroll-following-public"
                  refreshable={() => publicRefreshRef.current()}
                >
                  <UserConnectionsFeed
                    key="feed-following-public"
                    userID={userID}
                    kind="following"
                    restrict="public"
                    previewSide={previewSide}
                    hideNovels={hideNovels}
                    enabled={followingTab === "public"}
                    emptyText="暂无公开关注的创作者"
                    emptyIcon="person.2"
                    onFirstImageUrlChange={(url) => {
                      firstImageUrlsRef.current.public = url
                      if (followingTab === "public" && url) {
                        setAmbientImageUrl(url)
                        recordActiveAmbientImageUrl(url)
                      }
                    }}
                    onRegisterRefresh={(fn) => {
                      publicRefreshRef.current = fn
                    }}
                  />
                </RefreshableScrollView>
              </VStack>

              {/* 2. 私密关注列表保活容器（槽位 1：恒定槽位，内部按需挂载） */}
              <VStack
                key="slot-following-private"
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                opacity={followingTab === "private" ? 1 : 0}
                zIndex={followingTab === "private" ? 1 : 0}
                allowsHitTesting={followingTab === "private"}
              >
                {visitedTabs.has("private") ? (
                  <RefreshableScrollView
                    key="scroll-following-private"
                    refreshable={() => privateRefreshRef.current()}
                  >
                    <UserConnectionsFeed
                      key="feed-following-private"
                      userID={userID}
                      kind="following"
                      restrict="private"
                      previewSide={previewSide}
                      hideNovels={hideNovels}
                      enabled={followingTab === "private"}
                      emptyText="暂无私密关注的创作者"
                      emptyIcon="lock"
                      onFirstImageUrlChange={(url) => {
                        firstImageUrlsRef.current.private = url
                        if (followingTab === "private" && url) {
                          setAmbientImageUrl(url)
                          recordActiveAmbientImageUrl(url)
                        }
                      }}
                      onRegisterRefresh={(fn) => {
                        privateRefreshRef.current = fn
                      }}
                    />
                  </RefreshableScrollView>
                ) : null}
              </VStack>

              {/* 3. 推荐创作者保活容器（槽位 2：恒定槽位，内部按需挂载，绝不被位移） */}
              <VStack
                key="slot-following-recommended"
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                opacity={followingTab === "recommended" ? 1 : 0}
                zIndex={followingTab === "recommended" ? 1 : 0}
                allowsHitTesting={followingTab === "recommended"}
              >
                {visitedTabs.has("recommended") ? (
                  <RefreshableScrollView
                    key="scroll-following-recommended"
                    refreshable={() => recommendedRefreshRef.current()}
                  >
                    <RecommendedUsersFeed
                      key="feed-following-recommended"
                      previewSide={previewSide}
                      hideNovels={hideNovels}
                      enabled={followingTab === "recommended"}
                      onFirstImageUrlChange={(url) => {
                        firstImageUrlsRef.current.recommended = url
                        if (followingTab === "recommended" && url) {
                          setAmbientImageUrl(url)
                          recordActiveAmbientImageUrl(url)
                        }
                      }}
                      onRegisterRefresh={(fn) => {
                        recommendedRefreshRef.current = fn
                      }}
                    />
                  </RefreshableScrollView>
                ) : null}
              </VStack>
            </ZStack>
          )
        }

        // 场景 B：普通关系链（我的粉丝、我的好友、查看他人关注列表等通用单流）
        return (
          <RefreshableScrollView
            navigationTitle={navTitle}
            navigationBarTitleDisplayMode="inline"
            background={ambientBackground}
            toolbar={toolbarConfig}
            refreshable={handleActiveRefresh}
          >
            <UserConnectionsFeed
              userID={userID}
              kind={props.kind}
              restrict={restrict}
              previewSide={previewSide}
              hideNovels={hideNovels}
              emptyText={
                props.kind === "follower"
                  ? "暂时没有粉丝"
                  : props.kind === "mypixiv"
                    ? "暂时没有好友"
                    : "暂无关注创作者"
              }
              emptyIcon={
                props.kind === "follower"
                  ? "person.2.badge.plus"
                  : props.kind === "mypixiv"
                    ? "person.2.badge.gearshape"
                    : "person.2"
              }
              onFirstImageUrlChange={(url) => {
                if (url) {
                  setAmbientImageUrl(url)
                  recordActiveAmbientImageUrl(url)
                }
              }}
              onRegisterRefresh={(fn) => {
                genericRefreshRef.current = fn
              }}
            />
          </RefreshableScrollView>
        )
      }}
    </GeometryReader>
  )
}

/**
 * 通用关系链列表流组件（关注、粉丝、好友）
 */
function UserConnectionsFeed(props: {
  userID: number | null
  kind: ConnectionRouteKind
  restrict: ConnectionVisibility
  previewSide: number
  hideNovels: boolean
  emptyText: string
  emptyIcon: string
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const {
    userID,
    kind,
    restrict,
    previewSide,
    hideNovels,
    emptyText,
    emptyIcon,
    enabled = true,
    onFirstImageUrlChange,
    onRegisterRefresh,
  } = props

  const paged = usePagedList<ConnectionPreview>({
    first: async (token) =>
      normalizePage(await loadConnections(userID, kind, restrict, token)),
    more: async (nextURL, token) => normalizePage(await nextUsers(nextURL, token)),
    deps: [userID, kind, restrict],
    enabled,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).flatMap(connectionPreviewImageURLs)).cancel,
  })

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  const firstImageUrl = useMemo(() => {
    if (paged.items.length === 0) return null
    for (const item of paged.items) {
      const urls = connectionPreviewImageURLs(item).filter(Boolean) as string[]
      if (urls.length > 0) return urls[0]
    }
    return paged.items[0]?.user.profile_image_urls?.medium ?? null
  }, [paged.items])

  useEffect(() => {
    if (paged.initialLoading) return
    onFirstImageUrlChange?.(firstImageUrl)
  }, [paged.initialLoading, firstImageUrl, onFirstImageUrlChange])

  if (paged.initialLoading) {
    return <LoadingView />
  }

  if (paged.error && paged.items.length === 0) {
    return <ErrorView message={paged.error} onRetry={paged.refresh} />
  }

  if (paged.items.length === 0) {
    return <EmptyView text={emptyText} systemImage={emptyIcon} />
  }

  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: CONNECTION_LIST_HORIZONTAL_PADDING }}>
      {paged.items.map((preview, index) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          previewSide={previewSide}
          hideNovels={hideNovels}
          priority={index}
        />
      ))}
      <LoadMoreTrigger
        anchor={paged.items[paged.items.length - 1].user.id}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
        loadMoreError={paged.loadMoreError}
        onRetry={paged.retryLoadMore}
      />
    </LazyVStack>
  )
}

/**
 * 推荐创作者列表流组件（直接内聚在页面内，享受同级懒加载与滚动进度记忆）
 */
function RecommendedUsersFeed(props: {
  previewSide: number
  hideNovels: boolean
  enabled?: boolean
  onFirstImageUrlChange?: (url: string | null) => void
  onRegisterRefresh?: (fn: () => Promise<void>) => void
}) {
  const { previewSide, hideNovels, enabled = true, onFirstImageUrlChange, onRegisterRefresh } = props

  const paged = usePagedList<ConnectionPreview>({
    first: async (token) => normalizePage(await recommendedUsers(token)),
    more: async (nextURL, token) => normalizePage(await nextUsers(nextURL, token)),
    deps: [],
    enabled,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).flatMap(connectionPreviewImageURLs)).cancel,
  })

  useEffect(() => {
    onRegisterRefresh?.(paged.refresh)
  }, [paged.refresh, onRegisterRefresh])

  const firstImageUrl = useMemo(() => {
    if (paged.items.length === 0) return null
    for (const item of paged.items) {
      const urls = connectionPreviewImageURLs(item).filter(Boolean) as string[]
      if (urls.length > 0) return urls[0]
    }
    return paged.items[0]?.user.profile_image_urls?.medium ?? null
  }, [paged.items])

  useEffect(() => {
    if (paged.initialLoading) return
    onFirstImageUrlChange?.(firstImageUrl)
  }, [paged.initialLoading, firstImageUrl, onFirstImageUrlChange])

  if (paged.initialLoading) {
    return <LoadingView />
  }

  if (paged.error && paged.items.length === 0) {
    return <ErrorView message={paged.error} onRetry={paged.refresh} />
  }

  if (paged.items.length === 0) {
    return <EmptyView text="暂无推荐创作者" systemImage="sparkles" />
  }

  return (
    <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: CONNECTION_LIST_HORIZONTAL_PADDING }}>
      {paged.items.map((preview, index) => (
        <ConnectionRow
          key={preview.user.id}
          preview={preview}
          showFollowControl={preview.user.id !== session.userID}
          previewSide={previewSide}
          hideNovels={hideNovels}
          priority={index}
        />
      ))}
      <LoadMoreTrigger
        anchor={paged.items[paged.items.length - 1].user.id}
        onLoadMore={paged.loadMore}
        hasMore={paged.hasMore}
        isLoading={paged.loadingMore}
        loadMoreError={paged.loadMoreError}
        onRetry={paged.retryLoadMore}
      />
    </LazyVStack>
  )
}

async function loadConnections(
  userID: number | null,
  kind: ConnectionRouteKind,
  restrict: ConnectionVisibility,
  accessToken: string
) {
  if (userID == null) return { items: [], nextURL: null }
  if (kind === "mypixiv") return myPixivUsers(userID, accessToken)
  return userConnections(userID, kind, restrict, accessToken)
}

export function normalizePage(page: {
  items: PixivUserPreview[]
  nextURL: string | null
}): { items: ConnectionPreview[]; nextURL: string | null } {
  return {
    items: page.items.map((preview) => ({ ...preview, id: preview.user.id })),
    nextURL: page.nextURL,
  }
}
