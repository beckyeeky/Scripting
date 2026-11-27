import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { session } from "../../../../../Pix-Scripting/src/api/session"
import { onBlocklistChanged } from "../../../../../Pix-Scripting/src/store/blocklist"
import { onSettingsChanged } from "../../../../../Pix-Scripting/src/store/settings"
import type { PixivPage } from "../../../../../Pix-Scripting/src/types"

export interface UsePixivFeedOptions<T> {
  fetcher: (token: string) => Promise<PixivPage<T>>
  fetchMore?: (nextURL: string, token: string) => Promise<PixivPage<T>>
  keyOf?: (item: T) => string | number
  filter?: (items: T[]) => T[]
  deps: ReadonlyArray<unknown>
  enabled?: boolean
  maxAutoProbePages?: number
  publicEndpoint?: boolean
  onPageLoaded?: (items: T[]) => void
}

export interface PixivFeedState<T> {
  items: T[]
  rawItems: T[]
  loading: boolean
  refreshing: boolean
  loadingMore: boolean
  error: string | null
  loadMoreError: string | null
  hasMore: boolean
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  setRawItems: React.Dispatch<React.SetStateAction<T[]>>
}

function defaultKeyOf(item: any): string | number {
  if (item && typeof item === "object") {
    if (item.id != null) return item.id
    if (item.user?.id != null) return item.user.id
    if (item.novel?.id != null) return item.novel.id
  }
  return Math.random()
}

export function usePixivFeed<T>(options: UsePixivFeedOptions<T>): PixivFeedState<T> {
  const {
    fetcher,
    fetchMore,
    keyOf = defaultKeyOf,
    filter,
    deps,
    enabled = true,
    maxAutoProbePages = 3,
    publicEndpoint = false,
    onPageLoaded,
  } = options

  const [rawItems, setRawItems] = useState<T[]>([])
  const [loading, setLoading] = useState<boolean>(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [nextURL, setNextURL] = useState<string | null>(null)
  const [filterVersion, setFilterVersion] = useState(0)

  const genRef = useRef(0)
  const nextUrlRef = useRef<string | null>(null)
  const loadingMoreRef = useRef(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const fetchMoreRef = useRef(fetchMore)
  fetchMoreRef.current = fetchMore
  const filterRef = useRef(filter)
  filterRef.current = filter
  const keyOfRef = useRef(keyOf)
  keyOfRef.current = keyOf
  const onPageLoadedRef = useRef(onPageLoaded)
  onPageLoadedRef.current = onPageLoaded

  // Re-run client-side filtering live when R18/AI settings or blocklist change
  useEffect(() => {
    const stopSettings = onSettingsChanged(() => setFilterVersion((v) => v + 1))
    const stopBlocklist = onBlocklistChanged(() => setFilterVersion((v) => v + 1))
    return () => {
      stopSettings()
      stopBlocklist()
    }
  }, [])

  const callApi = useCallback(
    async (fn: (token: string) => Promise<PixivPage<T>>): Promise<PixivPage<T>> => {
      if (publicEndpoint) {
        return fn("")
      }
      return session.call(fn)
    },
    [publicEndpoint],
  )

  const dedupeMerge = useCallback((existing: T[], incoming: T[]): T[] => {
    if (incoming.length === 0) return existing
    const seen = new Set<string | number>()
    for (const item of existing) seen.add(keyOfRef.current(item))
    const appended: T[] = []
    for (const item of incoming) {
      const k = keyOfRef.current(item)
      if (!seen.has(k)) {
        seen.add(k)
        appended.push(item)
      }
    }
    return appended.length > 0 ? [...existing, ...appended] : existing
  }, [])

  const runInitialLoad = useCallback(
    async (isRefresh: boolean) => {
      if (!enabled) return
      const gen = ++genRef.current
      loadingMoreRef.current = false
      setLoadingMore(false)
      setLoadMoreError(null)
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
        setError(null)
      }

      try {
        let page = await callApi((token) => fetcherRef.current(token))
        if (gen !== genRef.current) return

        let collected = dedupeMerge([], page.items ?? [])
        let cursor = page.nextURL ?? null
        let probes = 0

        // Auto-probe at most maxAutoProbePages if strict filters hide an entire first page
        while (
          filterRef.current &&
          filterRef.current(collected).length === 0 &&
          cursor &&
          fetchMoreRef.current &&
          probes < maxAutoProbePages
        ) {
          probes += 1
          const nextCursor = cursor
          const extra = await callApi((token) => fetchMoreRef.current!(nextCursor, token))
          if (gen !== genRef.current) return
          collected = dedupeMerge(collected, extra.items ?? [])
          cursor = extra.nextURL ?? null
        }

        nextUrlRef.current = cursor
        setNextURL(cursor)
        setRawItems(collected)
        setError(null)
        onPageLoadedRef.current?.(collected)
      } catch (err: any) {
        if (gen !== genRef.current) return
        setError(err?.message ?? "加载失败，请检查网络连接")
      } finally {
        if (gen === genRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [enabled, callApi, dedupeMerge, maxAutoProbePages],
  )

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void runInitialLoad(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  const refresh = useCallback(async () => {
    await runInitialLoad(true)
  }, [runInitialLoad])

  const loadMore = useCallback(async () => {
    if (!enabled || loadingMoreRef.current) return
    const cursor = nextUrlRef.current
    if (!cursor || !fetchMoreRef.current) return

    const gen = genRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)

    try {
      let currentCursor: string | null = cursor
      let probes = 0
      let appendedAll: T[] = []

      while (currentCursor && probes <= maxAutoProbePages) {
        const pageCursor = currentCursor
        const page = await callApi((token) => fetchMoreRef.current!(pageCursor, token))
        if (gen !== genRef.current) return

        const pageItems = page.items ?? []
        appendedAll = dedupeMerge(appendedAll, pageItems)
        currentCursor = page.nextURL ?? null
        probes += 1

        if (!filterRef.current || filterRef.current(appendedAll).length > 0) {
          break
        }
      }

      nextUrlRef.current = currentCursor
      setNextURL(currentCursor)
      if (appendedAll.length > 0) {
        setRawItems((prev) => dedupeMerge(prev, appendedAll))
        onPageLoadedRef.current?.(appendedAll)
      }
    } catch (err: any) {
      if (gen !== genRef.current) return
      setLoadMoreError(err?.message ?? "加载下一页失败")
    } finally {
      if (gen === genRef.current) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [enabled, callApi, dedupeMerge, maxAutoProbePages])

  const items = useMemo(() => {
    void filterVersion
    return filter ? filter(rawItems) : rawItems
  }, [rawItems, filter, filterVersion])

  return {
    items,
    rawItems,
    loading,
    refreshing,
    loadingMore,
    error,
    loadMoreError,
    hasMore: Boolean(nextURL && fetchMore),
    refresh,
    loadMore,
    setRawItems,
  }
}
