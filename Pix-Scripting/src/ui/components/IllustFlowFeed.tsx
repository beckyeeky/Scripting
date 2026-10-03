import {
  HStack,
  LazyVStack,
  ProgressView,
  Rectangle,
  Spacer,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { useLayoutMetrics } from "../Hooks"
import { cacheIllusts } from "../../store/illustCache"
import { loadSettings, onSettingsChanged } from "../../store/settings"
import { resolveFeedColumnCount } from "../feedColumns"
import { LoadMoreErrorRetry } from "./RefreshableScrollView"
import {
  FLOW_COLUMN_SPACING,
  FLOW_HORIZONTAL_PADDING,
  FLOW_ROW_SPACING,
  IllustCard,
  MIN_FLOW_IMAGE_RATIO,
  calculateFlowCardWidth,
  calculateHeroCardWidth,
  type IllustCardAction,
} from "./IllustCard"
import type { PixivIllustration } from "../../types"

export type IllustFlowItem = {
  illust: PixivIllustration
  index: number
}

export interface IllustFlowFeedProps {
  items: PixivIllustration[]
  onLoadMore: (anchor: number | string) => void
  hasMore?: boolean
  isLoading?: boolean
  loadMoreError?: string | null
  onRetryLoadMore?: () => void
  enableHeroFirst?: boolean
  cornerBadgeOf?: (illust: PixivIllustration, index: number) => any
  footerTextOf?: (illust: PixivIllustration, index: number) => string | undefined
  topTrailingActionOf?: (
    illust: PixivIllustration,
    index: number,
  ) => IllustCardAction | undefined
  contextMenuOf?: (
    illust: PixivIllustration,
    index: number,
  ) => any
  bottomInset?: number
}

function distributeFlowItems(
  items: PixivIllustration[],
  startIndex = 0,
  cardWidth: number = calculateFlowCardWidth(),
  columnCount: number = 2
): IllustFlowItem[][] {
  const count = Math.max(1, columnCount)
  const columns: IllustFlowItem[][] = Array.from({ length: count }, () => [])
  const heights = new Array(count).fill(0)
  for (let i = 0; i < items.length; i++) {
    const illust = items[i]
    const index = startIndex + i
    const rawRatio = illust.width > 0 && illust.height > 0
      ? illust.width / illust.height
      : 0.75
    const ratio = Math.max(rawRatio, MIN_FLOW_IMAGE_RATIO)
    const imageHeight = cardWidth / ratio
    const textHeight = 62
    const footerHeight = 10
    let minCol = 0
    for (let c = 1; c < count; c++) {
      if (heights[c] < heights[minCol]) {
        minCol = c
      }
    }
    columns[minCol].push({ illust, index })
    heights[minCol] += imageHeight + textHeight + footerHeight
  }
  return columns
}

export function IllustFlowFeed(props: IllustFlowFeedProps) {
  cacheIllusts(props.items)
  const { width: containerWidth, isLandscape } = useLayoutMetrics()
  const [columnCaps, setColumnCaps] = useState(() => {
    const settings = loadSettings()
    return {
      landscape: settings.feedColumnCapLandscape,
      portrait: settings.feedColumnCapPortrait,
    }
  })

  useEffect(() => {
    return onSettingsChanged(() => {
      const settings = loadSettings()
      setColumnCaps({
        landscape: settings.feedColumnCapLandscape,
        portrait: settings.feedColumnCapPortrait,
      })
    })
  }, [])

  const columnCount = useMemo(
    () => resolveFeedColumnCount(containerWidth, isLandscape, columnCaps),
    [containerWidth, isLandscape, columnCaps]
  )

  const flowCardWidth = useMemo(
    () => calculateFlowCardWidth(containerWidth, columnCount),
    [containerWidth, columnCount]
  )
  const heroCardWidth = useMemo(() => calculateHeroCardWidth(containerWidth), [containerWidth])

  // 首图大卡片：仅在 2 列形态（iPhone 或极窄窗口）且用户开启首图大卡设置时激活；
  // 3 列及以上（中等大小 / 宽屏）自动保持均等多列网格，首图不跨行。
  const isHeroActive = columnCount <= 2 && Boolean(props.enableHeroFirst && props.items.length > 0)
  const heroItem = isHeroActive ? props.items[0] : null
  const waterfallItems = isHeroActive ? props.items.slice(1) : props.items
  const startIndex = isHeroActive ? 1 : 0

  const columns = useMemo(
    () => distributeFlowItems(waterfallItems, startIndex, flowCardWidth, columnCount),
    [waterfallItems, startIndex, flowCardWidth, columnCount]
  )
  const lastItem = props.items[props.items.length - 1]
  const lastId = lastItem ? lastItem.id : null
  const triggerAnchor = lastId != null ? String(lastId) : ""

  const columnViews = useMemo(
    () => {
      const renderItem = ({ illust, index }: IllustFlowItem) => (
        <IllustCard
          key={illust.id}
          illust={illust}
          cardWidth={flowCardWidth}
          flow={true}
          priority={index}
          isSprint={index === 0}
          cornerBadge={props.cornerBadgeOf?.(illust, index)}
          footerText={props.footerTextOf?.(illust, index)}
          topTrailingAction={props.topTrailingActionOf?.(illust, index)}
          contextMenu={props.contextMenuOf?.(illust, index)}
        />
      )
      const triggerView = props.hasMore && triggerAnchor ? (
        <VStack
          key={`trigger:${triggerAnchor}`}
          frame={{ width: flowCardWidth, height: 1 }}
          onAppear={() => {
            if (!props.loadMoreError) {
              props.onLoadMore(triggerAnchor)
            }
          }}
        />
      ) : null
      return columns.map((colItems, colIndex) => (
        <LazyVStack
          key={`flow-col-${colIndex}`}
          alignment="leading"
          spacing={FLOW_ROW_SPACING}
          frame={{ width: flowCardWidth }}
        >
          {colItems.map(renderItem)}
          {triggerView}
        </LazyVStack>
      ))
    },
    [
      columns,
      flowCardWidth,
      triggerAnchor,
      props.hasMore,
      props.loadMoreError,
      props.onLoadMore,
      props.cornerBadgeOf,
      props.footerTextOf,
      props.topTrailingActionOf,
      props.contextMenuOf,
    ]
  )

  const heroView = useMemo(() => {
    if (!heroItem) return null
    return (
      <VStack
        key={`hero:${heroItem.id}`}
        padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
        frame={{ width: containerWidth }}
      >
        <IllustCard
          key={heroItem.id}
          illust={heroItem}
          cardWidth={heroCardWidth}
          hero={true}
          priority={0}
          isSprint={true}
          cornerBadge={props.cornerBadgeOf?.(heroItem, 0)}
          footerText={props.footerTextOf?.(heroItem, 0)}
          topTrailingAction={props.topTrailingActionOf?.(heroItem, 0)}
          contextMenu={props.contextMenuOf?.(heroItem, 0)}
        />
      </VStack>
    )
  }, [
    heroItem,
    containerWidth,
    heroCardWidth,
    props.cornerBadgeOf,
    props.footerTextOf,
    props.topTrailingActionOf,
    props.contextMenuOf,
  ])

  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
      {heroView}
      {waterfallItems.length > 0 ? (
        <HStack
          alignment="top"
          spacing={FLOW_COLUMN_SPACING}
          padding={{ horizontal: FLOW_HORIZONTAL_PADDING }}
          frame={{ width: containerWidth }}
        >
          {columnViews}
        </HStack>
      ) : props.hasMore && triggerAnchor ? (
        <VStack
          key={`hero-trigger:${triggerAnchor}`}
          frame={{ width: flowCardWidth, height: 1 }}
          onAppear={() => {
            if (!props.loadMoreError) {
              props.onLoadMore(triggerAnchor)
            }
          }}
        />
      ) : null}
      {props.hasMore ? (
        <VStack key="flow-footer" spacing={0} frame={{ maxWidth: "infinity" }}>
          {props.isLoading || props.loadMoreError ? (
            <VStack spacing={0} frame={{ height: 48, maxWidth: "infinity" }}>
              {props.isLoading ? (
                <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                  <Spacer />
                  <ProgressView progressViewStyle="circular" />
                  <Spacer />
                </HStack>
              ) : props.loadMoreError ? (
                <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                  <Spacer />
                  <LoadMoreErrorRetry
                    message={props.loadMoreError}
                    onRetry={() => {
                      if (props.onRetryLoadMore) {
                        props.onRetryLoadMore()
                      } else if (triggerAnchor) {
                        props.onLoadMore(triggerAnchor)
                      }
                    }}
                  />
                  <Spacer />
                </HStack>
              ) : null}
            </VStack>
          ) : null}
          {(props.bottomInset ?? loadSettings().feedBottomInset) > 0 ? (
            <Rectangle
              key="flow-footer-spacer"
              fill="clear"
              frame={{ height: props.bottomInset ?? loadSettings().feedBottomInset, maxWidth: "infinity" }}
            />
          ) : null}
        </VStack>
      ) : (props.bottomInset ?? loadSettings().feedBottomInset) > 0 ? (
        <Rectangle
          key="flow-footer-spacer"
          fill="clear"
          frame={{ height: props.bottomInset ?? loadSettings().feedBottomInset, maxWidth: "infinity" }}
        />
      ) : null}
    </VStack>
  )
}
