import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  fetchTagFilteredNovelsByUrl,
  fetchTagFilteredWorksByUrl,
  fetchUserBookmarkTags,
  fetchUserTagFilteredNovels,
  fetchUserTagFilteredWorks,
  fetchUserWorkTags,
  fetchWebUserDetail,
  followUser,
  nextIllustrations,
  nextNovels,
  unfollowUser,
  userBookmarks,
  userDetail,
  userNovelBookmarks,
  userNovels,
  userWorks,
  type Visibility,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import {
  downloadAuthorIllustrationsToAlbum,
  downloadAuthorUgoiraToAlbum,
  exportAuthorIllustrationsToZip,
  exportAuthorManga,
  exportAuthorNovels,
  fetchAllUserIllustrations,
  fetchAllUserNovels,
} from "../../../../../../Pix-Scripting/src/downloader/authorDownloader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  blockUser,
  isUserBlocked,
  onBlocklistChanged,
  unblockUser,
} from "../../../../../../Pix-Scripting/src/store/blocklist"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import {
  getEffectiveFollowState,
  onUserFollowChanged,
  recordUserFollowed,
} from "../../../../../../Pix-Scripting/src/store/userFollow"
import type {
  PixivIllustration,
  PixivNovel,
  PixivUser,
  PixivUserDetail,
  PixivWebUserDetail,
  PixivWebUserTag,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ChipBar,
  ErrorView,
  HeaderIconButton,
  IllustMasonryFeed,
  LoadingView,
  NovelFeedList,
  PixAvatar,
  PixImage,
  ScreenHeader,
  SegmentedControl,
  usePixivFeed,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { useAppTheme } from "../../theme/ThemeProvider"
import {
  copyToClipboard,
  formatMetricCount,
  handlePixivHref,
  openExternalUrl,
  parseCaptionSegments,
  shareItems,
} from "./mediaHelpers"
import { RelatedUsersSheet } from "./RelatedUsersSheet"

type ProfileTab = "illust" | "manga" | "novel" | "bookmarks"

export function UserDetailScreen({
  userID,
  seed,
}: {
  userID: number
  seed?: PixivUser
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const nav = useAppNav()
  const overlay = useOverlay()

  const isSelf = userID === session.userID
  const [detail, setDetail] = useState<PixivUserDetail | null>(null)
  const [webDetail, setWebDetail] = useState<PixivWebUserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<ProfileTab>("illust")
  const [bookmarkKind, setBookmarkKind] = useState<"illust" | "novel">("illust")
  const [bookmarkRestrict, setBookmarkRestrict] = useState<Visibility>("public")

  const [workTags, setWorkTags] = useState<PixivWebUserTag[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagGenRef = useRef(0)

  const [bioExpanded, setBioExpanded] = useState(false)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false)
  const [batchStatus, setBatchStatus] = useState<string | null>(null)

  const [followed, setFollowed] = useState<boolean>(() =>
    getEffectiveFollowState(userID, Boolean(seed?.is_followed)).followed,
  )
  const [followBusy, setFollowBusy] = useState(false)
  const [blocked, setBlocked] = useState<boolean>(() => isUserBlocked(userID))

  // Load userDetail + optional web enrichment
  const fetchProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await session.call((token) => userDetail(userID, token))
      setDetail(res)
      if (res.user) {
        recordUserFollowed(res.user.id, Boolean(res.user.is_followed))
        setFollowed(getEffectiveFollowState(res.user.id, Boolean(res.user.is_followed)).followed)
      }
      // Best-effort web detail enrichment (workspace/social)
      void fetchWebUserDetail(userID)
        .then((wd) => {
          if (wd) setWebDetail(wd)
        })
        .catch(() => {})
    } catch (err: any) {
      setError(err?.message ?? "加载画师资料失败")
    } finally {
      setLoading(false)
    }
  }, [userID])

  useEffect(() => {
    setDetail(null)
    setWebDetail(null)
    setSelectedTag(null)
    setWorkTags([])
    void fetchProfile()
  }, [fetchProfile])

  useEffect(() => {
    setFollowed(getEffectiveFollowState(userID, Boolean(seed?.is_followed)).followed)
    return onUserFollowChanged((uid, next) => {
      if (uid === userID) setFollowed(next)
    })
  }, [userID, seed?.is_followed])

  useEffect(() => {
    setBlocked(isUserBlocked(userID))
    return onBlocklistChanged(() => setBlocked(isUserBlocked(userID)))
  }, [userID])

  // Race-safe work/bookmark tag fetching
  useEffect(() => {
    const gen = ++tagGenRef.current
    setSelectedTag(null)
    setWorkTags([])

    void (async () => {
      try {
        let tags: PixivWebUserTag[] = []
        if (tab === "bookmarks") {
          tags = await fetchUserBookmarkTags(userID, bookmarkKind, 24, isSelf ? bookmarkRestrict : "public")
        } else {
          tags = await fetchUserWorkTags(userID, tab, 24)
        }
        if (gen !== tagGenRef.current) return
        setWorkTags(tags)
      } catch {
        if (gen === tagGenRef.current) setWorkTags([])
      }
    })()
  }, [userID, tab, bookmarkKind, bookmarkRestrict, isSelf])

  const illustFilter = useCallback(
    (items: PixivIllustration[]) =>
      items.filter((it) => isIllustContentVisible(it, undefined, undefined, { exemptBlockedUser: true })),
    [],
  )

  const novelFilter = useCallback(
    (items: PixivNovel[]) =>
      items.filter((it) => isNovelContentVisible(it, undefined, undefined, { exemptBlockedUser: true })),
    [],
  )

  const isIllustMode = tab === "illust" || tab === "manga" || (tab === "bookmarks" && bookmarkKind === "illust")
  const isNovelMode = tab === "novel" || (tab === "bookmarks" && bookmarkKind === "novel")

  const illustFeed = usePixivFeed<PixivIllustration>({
    enabled: isIllustMode,
    deps: [userID, tab, bookmarkKind, bookmarkRestrict, selectedTag],
    filter: illustFilter,
    fetcher: (token) => {
      if (tab === "bookmarks") {
        return userBookmarks(userID, isSelf ? bookmarkRestrict : "public", token, selectedTag)
      }
      const kind = tab === "manga" ? "manga" : "illust"
      if (selectedTag) {
        return fetchUserTagFilteredWorks(userID, kind, selectedTag, 0, 48)
      }
      return userWorks(userID, kind, token)
    },
    fetchMore: (nextURL, token) => {
      if (nextURL.startsWith("web-tag://")) {
        return fetchTagFilteredWorksByUrl(nextURL)
      }
      return nextIllustrations(nextURL, token)
    },
  })

  const novelFeed = usePixivFeed<PixivNovel>({
    enabled: isNovelMode,
    deps: [userID, tab, bookmarkKind, bookmarkRestrict, selectedTag],
    filter: novelFilter,
    fetcher: (token) => {
      if (tab === "bookmarks") {
        return userNovelBookmarks(userID, isSelf ? bookmarkRestrict : "public", selectedTag, token)
      }
      if (selectedTag) {
        return fetchUserTagFilteredNovels(userID, selectedTag, 0, 24)
      }
      return userNovels(userID, token)
    },
    fetchMore: (nextURL, token) => {
      if (nextURL.startsWith("web-tag://")) {
        return fetchTagFilteredNovelsByUrl(nextURL)
      }
      return nextNovels(nextURL, token)
    },
  })

  const activeUser = detail?.user ?? seed
  const displayName = activeUser?.name || webDetail?.name || `用户 #${userID}`
  const displayAccount = activeUser?.account || ""
  const avatarUrl = activeUser?.profile_image_urls?.medium || webDetail?.imageBig || webDetail?.image
  const bannerUrl = detail?.profile?.background_image_url
  const bioSegments = useMemo(
    () => parseCaptionSegments(webDetail?.commentHtml || activeUser?.comment || webDetail?.comment),
    [activeUser?.comment, webDetail?.comment, webDetail?.commentHtml],
  )

  const workspaceEntries = useMemo(() => {
    const ws = detail?.workspace
    const entries: Array<{ label: string; value: string }> = []
    if (ws?.pc) entries.push({ label: "电脑", value: ws.pc })
    if (ws?.monitor) entries.push({ label: "显示器", value: ws.monitor })
    if (ws?.tool) entries.push({ label: "软件", value: ws.tool })
    if (ws?.tablet) entries.push({ label: "数位板", value: ws.tablet })
    if (ws?.music) entries.push({ label: "音乐", value: ws.music })
    if (ws?.desk) entries.push({ label: "桌子", value: ws.desk })
    if (ws?.chair) entries.push({ label: "椅子", value: ws.chair })
    if (ws?.comment) entries.push({ label: "备注", value: ws.comment })
    if (detail?.profile?.webpage) entries.push({ label: "主页", value: detail.profile.webpage })
    if (detail?.profile?.twitter_account) {
      entries.push({ label: "X / Twitter", value: `@${detail.profile.twitter_account}` })
    }
    if (detail?.profile?.region) entries.push({ label: "地区", value: detail.profile.region })
    if (detail?.profile?.job) entries.push({ label: "职业", value: detail.profile.job })
    return entries
  }, [detail])

  const toggleFollow = useCallback(
    async (restrict: Visibility = "public", forceFollow?: boolean) => {
      if (followBusy || isSelf) return
      const next = forceFollow ?? !followed
      const prev = followed
      setFollowed(next)
      setFollowBusy(true)
      try {
        triggerHaptic("selection")
      } catch {}
      try {
        await session.call((token) =>
          next ? followUser(userID, restrict, token) : unfollowUser(userID, token),
        )
        if (next && restrict === "private") {
          overlay.showToast("已悄悄关注该画师", "success")
        }
      } catch (err: any) {
        setFollowed(prev)
        overlay.showToast(err?.message ?? "关注操作失败", "error")
      } finally {
        setFollowBusy(false)
      }
    },
    [followBusy, followed, isSelf, overlay, userID],
  )

  const openFollowMenu = useCallback(async () => {
    if (isSelf) return
    const idx = await overlay.presentActionSheet({
      title: displayName,
      actions: [
        { label: "公开关注" },
        { label: "悄悄关注（私密）" },
        ...(followed ? [{ label: "取消关注", destructive: true }] : []),
      ],
    })
    if (idx === 0) void toggleFollow("public", true)
    else if (idx === 1) void toggleFollow("private", true)
    else if (idx === 2) void toggleFollow("public", false)
  }, [displayName, followed, isSelf, overlay, toggleFollow])

  const openBatchArchive = useCallback(async () => {
    if (batchStatus) return
    const choice = await overlay.presentActionSheet({
      title: `批量归档 · ${displayName}`,
      message: "任务将在下载管理器中执行，支持暂停与续传",
      actions: [
        { label: "保存全部插画至系统相册" },
        { label: "打包全部插画为 ZIP 归档" },
        { label: "导出全部动图至系统相册" },
        { label: "打包全部漫画为 CBZ" },
        { label: "打包全部漫画为 EPUB" },
        { label: "打包全部小说为 EPUB" },
      ],
    })
    if (choice == null) return

    setBatchStatus("正在扫描画师作品列表…")
    try {
      if (choice === 0 || choice === 1 || choice === 2) {
        const all = await fetchAllUserIllustrations(userID, "illust", (msg) => setBatchStatus(msg))
        if (all.length === 0) {
          overlay.showToast("该画师没有可导出的插画/动图", "info")
          return
        }
        if (choice === 0) {
          const res = await downloadAuthorIllustrationsToAlbum(displayName, all, (msg) =>
            setBatchStatus(msg),
          )
          overlay.showToast(`已完成：保存 ${res.successCount}/${res.totalCount} 部插画`, "success")
        } else if (choice === 1) {
          const zipPath = await exportAuthorIllustrationsToZip(displayName, userID, all, (msg) =>
            setBatchStatus(msg),
          )
          overlay.showToast(zipPath ? "画师插画全集 ZIP 已保存" : "ZIP 导出未完成", zipPath ? "success" : "error")
        } else {
          const ugoiras = all.filter((it) => it.type === "ugoira")
          if (ugoiras.length === 0) {
            overlay.showToast("该画师没有动图作品", "info")
            return
          }
          const res = await downloadAuthorUgoiraToAlbum(displayName, ugoiras, (msg) =>
            setBatchStatus(msg),
          )
          overlay.showToast(`已完成：导出 ${res.successCount}/${res.totalCount} 部动图`, "success")
        }
      } else if (choice === 3 || choice === 4) {
        const allManga = await fetchAllUserIllustrations(userID, "manga", (msg) =>
          setBatchStatus(msg),
        )
        if (allManga.length === 0) {
          overlay.showToast("该画师没有漫画作品", "info")
          return
        }
        const fmt = choice === 3 ? "cbz" : "epub"
        const res = await exportAuthorManga(displayName, userID, allManga, fmt, (msg) =>
          setBatchStatus(msg),
        )
        overlay.showToast(`已导出 ${res.totalExported} 册漫画 (${fmt.toUpperCase()})`, "success")
      } else if (choice === 5) {
        const allNovels = await fetchAllUserNovels(userID, (msg) => setBatchStatus(msg))
        if (allNovels.length === 0) {
          overlay.showToast("该画师没有小说作品", "info")
          return
        }
        const res = await exportAuthorNovels(displayName, userID, allNovels, (msg) =>
          setBatchStatus(msg),
        )
        overlay.showToast(`已导出 ${res.totalExported} 册小说 EPUB`, "success")
      }
    } catch (err: any) {
      overlay.showToast(err?.message ?? "批量归档失败", "error")
    } finally {
      setBatchStatus(null)
    }
  }, [batchStatus, displayName, overlay, userID])

  const openMoreMenu = useCallback(async () => {
    const webUrl = `https://www.pixiv.net/users/${userID}`
    const idx = await overlay.presentActionSheet({
      title: displayName,
      actions: [
        { label: "批量下载 / 归档该画师作品" },
        { label: "相关推荐画师" },
        { label: "分享画师主页" },
        { label: "复制用户 ID" },
        { label: "在浏览器打开" },
        ...(!isSelf
          ? [
              {
                label: blocked ? "取消屏蔽该画师" : "屏蔽该画师",
                destructive: !blocked,
              },
            ]
          : []),
      ],
    })
    if (idx === 0) {
      void openBatchArchive()
    } else if (idx === 1) {
      overlay.presentSheet({
        title: `与 ${displayName} 相关的画师`,
        fullHeight: true,
        render: (close) => <RelatedUsersSheet seedUserID={userID} onClose={close} />,
      })
    } else if (idx === 2) {
      await shareItems([webUrl])
    } else if (idx === 3) {
      await copyToClipboard(String(userID))
      overlay.showToast(`已复制 UID: ${userID}`, "success")
    } else if (idx === 4) {
      await openExternalUrl(webUrl)
    } else if (!isSelf && idx === 5) {
      if (blocked) {
        unblockUser(userID)
        overlay.showToast("已取消屏蔽", "success")
      } else {
        blockUser({
          id: userID,
          name: displayName,
          account: displayAccount,
          avatarURL: avatarUrl,
        })
        overlay.showToast("已屏蔽该画师", "info")
      }
    }
  }, [avatarUrl, blocked, displayAccount, displayName, isSelf, openBatchArchive, overlay, userID])

  const tabChips = useMemo<ChipItem<ProfileTab>[]>(() => {
    const p = detail?.profile
    return [
      { value: "illust", label: "插画", badge: p ? p.total_illusts : undefined },
      { value: "manga", label: "漫画", badge: p ? p.total_manga : undefined },
      { value: "novel", label: "小说", badge: p ? p.total_novels : undefined },
      {
        value: "bookmarks",
        label: "收藏",
        badge: p ? p.total_illust_bookmarks_public : undefined,
      },
    ]
  }, [detail?.profile])

  const tagChips = useMemo<ChipItem<string>[]>(() => {
    if (workTags.length === 0) return []
    return [
      { value: "__ALL__", label: "全部" },
      ...workTags.map((t) => ({
        value: t.tag,
        label: t.tag_translation ? `${t.tag} · ${t.tag_translation}` : t.tag,
        badge: t.cnt > 0 ? t.cnt : undefined,
      })),
    ]
  }, [workTags])

  const headerElement = (
    <View style={styles.profileHeader}>
      {batchStatus ? (
        <View style={[styles.batchBanner, { backgroundColor: accentSoft }]}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={[styles.batchText, { color: accent }]} numberOfLines={1}>
            {batchStatus}
          </Text>
        </View>
      ) : null}

      {/* Banner */}
      <View style={[styles.bannerWrap, { backgroundColor: colors.fill }]}>
        {bannerUrl ? (
          <PixImage url={bannerUrl} resizeMode="cover" style={StyleSheet.absoluteFill} />
        ) : null}
      </View>

      {/* Profile card */}
      <View
        style={[
          styles.profileCard,
          { backgroundColor: colors.surface, borderColor: colors.glassBorder },
        ]}
      >
        <View style={styles.avatarRow}>
          <PixAvatar url={avatarUrl} name={displayName} size={64} />
          <View style={styles.identityCol}>
            <View style={styles.nameLine}>
              <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                {displayName}
              </Text>
              {detail?.profile?.is_premium ? (
                <View style={[styles.premiumBadge, { backgroundColor: colors.orange }]}>
                  <Text style={styles.premiumText}>P</Text>
                </View>
              ) : null}
              {blocked ? (
                <View style={[styles.premiumBadge, { backgroundColor: colors.danger }]}>
                  <Text style={styles.premiumText}>已屏蔽</Text>
                </View>
              ) : null}
            </View>
            {displayAccount ? (
              <Text style={[styles.userAccount, { color: colors.textSecondary }]} numberOfLines={1}>
                @{displayAccount} · ID {userID}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.profileActions}>
          {!isSelf ? (
            <Pressable
              onPress={() => void toggleFollow("public")}
              onLongPress={() => void openFollowMenu()}
              disabled={followBusy}
              style={[
                styles.primaryActionBtn,
                {
                  backgroundColor: followed ? colors.fill : accent,
                  borderColor: followed ? colors.glassBorder : accent,
                },
              ]}
            >
              <Text style={[styles.primaryActionText, { color: followed ? colors.text : "#FFFFFF" }]}>
                {followed ? "已关注（长按切换）" : "+ 关注"}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => void openBatchArchive()}
            disabled={Boolean(batchStatus)}
            style={[
              styles.secondaryActionBtn,
              { backgroundColor: colors.fill, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.secondaryActionText, { color: colors.text }]}>↓ 归档</Text>
          </Pressable>

          <Pressable
            onPress={() =>
              overlay.presentSheet({
                title: `与 ${displayName} 相关的画师`,
                fullHeight: true,
                render: (close) => <RelatedUsersSheet seedUserID={userID} onClose={close} />,
              })
            }
            style={[
              styles.secondaryActionBtn,
              { backgroundColor: colors.fill, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.secondaryActionText, { color: colors.text }]}>相关画师</Text>
          </Pressable>
        </View>

        {/* Stats row */}
        {detail?.profile ? (
          <View style={[styles.statsBar, { borderTopColor: colors.separator }]}>
            <Pressable
              onPress={() =>
                nav.push({
                  name: "userConnections",
                  kind: "following",
                  userId: userID,
                  title: `${displayName} 的关注`,
                })
              }
              style={styles.statCell}
            >
              <Text style={[styles.statVal, { color: colors.text }]}>
                {formatMetricCount(detail.profile.total_follow_users)}
              </Text>
              <Text style={[styles.statLbl, { color: colors.textSecondary }]}>关注</Text>
            </Pressable>

            <Pressable
              onPress={() =>
                nav.push({
                  name: "userConnections",
                  kind: "mypixiv",
                  userId: userID,
                  title: `${displayName} 的好P友`,
                })
              }
              style={styles.statCell}
            >
              <Text style={[styles.statVal, { color: colors.text }]}>
                {formatMetricCount(detail.profile.total_mypixiv_users)}
              </Text>
              <Text style={[styles.statLbl, { color: colors.textSecondary }]}>好P友</Text>
            </Pressable>

            <Pressable
              onPress={() => nav.push({ name: "userBookmarks", userId: userID })}
              style={styles.statCell}
            >
              <Text style={[styles.statVal, { color: colors.text }]}>
                {formatMetricCount(detail.profile.total_illust_bookmarks_public)}
              </Text>
              <Text style={[styles.statLbl, { color: colors.textSecondary }]}>公开收藏</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Bio */}
        {bioSegments.length > 0 ? (
          <View style={[styles.bioWrap, { borderTopColor: colors.separator }]}>
            <Text
              numberOfLines={bioExpanded ? undefined : 4}
              style={[styles.bioText, { color: colors.text }]}
            >
              {bioSegments.map((seg, idx) =>
                seg.type === "link" && seg.href ? (
                  <Text
                    key={idx}
                    style={{ color: accent, textDecorationLine: "underline" }}
                    onPress={() => handlePixivHref(seg.href!, nav)}
                  >
                    {seg.text}
                  </Text>
                ) : (
                  <Text key={idx}>{seg.text}</Text>
                ),
              )}
            </Text>
            <Pressable onPress={() => setBioExpanded((v) => !v)} hitSlop={8}>
              <Text style={[styles.toggleText, { color: accent }]}>
                {bioExpanded ? "收起简介" : "展开全部简介"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Workspace / profile info */}
        {workspaceEntries.length > 0 ? (
          <View style={[styles.bioWrap, { borderTopColor: colors.separator }]}>
            <Pressable
              onPress={() => setWorkspaceExpanded((v) => !v)}
              style={styles.wsHeader}
            >
              <Text style={[styles.wsTitle, { color: colors.textSecondary }]}>
                工作环境与资料 ({workspaceEntries.length})
              </Text>
              <Text style={[styles.toggleText, { color: accent }]}>
                {workspaceExpanded ? "收起" : "查看"}
              </Text>
            </Pressable>
            {workspaceExpanded ? (
              <View style={styles.wsList}>
                {workspaceEntries.map((entry) => (
                  <View key={entry.label} style={styles.wsRow}>
                    <Text style={[styles.wsKey, { color: colors.textTertiary }]}>{entry.label}</Text>
                    <Text
                      style={[
                        styles.wsVal,
                        { color: entry.value.startsWith("http") ? accent : colors.text },
                      ]}
                      onPress={
                        entry.value.startsWith("http")
                          ? () => void openExternalUrl(entry.value)
                          : undefined
                      }
                    >
                      {entry.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Content tabs */}
      <View style={styles.tabsWrap}>
        <ChipBar items={tabChips} selected={tab} onSelect={setTab} />
      </View>

      {/* Bookmarks sub-controls */}
      {tab === "bookmarks" ? (
        <View style={styles.bookmarkControls}>
          <View style={styles.flex}>
            <SegmentedControl
              value={bookmarkKind}
              onChange={setBookmarkKind}
              options={[
                { value: "illust", label: "插画收藏" },
                { value: "novel", label: "小说收藏" },
              ]}
            />
          </View>
          {isSelf ? (
            <View style={styles.restrictSeg}>
              <SegmentedControl
                value={bookmarkRestrict}
                onChange={setBookmarkRestrict}
                options={[
                  { value: "public", label: "公开" },
                  { value: "private", label: "私密" },
                ]}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Race-safe tag filter bar */}
      {tagChips.length > 0 ? (
        <ChipBar
          compact={true}
          items={tagChips}
          selected={selectedTag ?? "__ALL__"}
          onSelect={(val) => setSelectedTag(val === "__ALL__" ? null : val)}
        />
      ) : null}
    </View>
  )

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={displayName}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={<HeaderIconButton label="⋯" onPress={() => void openMoreMenu()} />}
      />

      {loading && !detail && !seed ? (
        <LoadingView message="正在加载画师主页…" />
      ) : error && !detail && !seed ? (
        <ErrorView message={error} onRetry={() => void fetchProfile()} />
      ) : isIllustMode ? (
        <IllustMasonryFeed
          items={illustFeed.items}
          loading={illustFeed.loading}
          refreshing={illustFeed.refreshing}
          loadingMore={illustFeed.loadingMore}
          error={illustFeed.error}
          loadMoreError={illustFeed.loadMoreError}
          hasMore={illustFeed.hasMore}
          onRefresh={() => {
            void fetchProfile()
            void illustFeed.refresh()
          }}
          onLoadMore={() => void illustFeed.loadMore()}
          emptyTitle={selectedTag ? `标签 #${selectedTag} 下暂无作品` : "暂无作品"}
          ListHeaderComponent={headerElement}
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
          onRefresh={() => {
            void fetchProfile()
            void novelFeed.refresh()
          }}
          onLoadMore={() => void novelFeed.loadMore()}
          emptyTitle={selectedTag ? `标签 #${selectedTag} 下暂无小说` : "暂无小说"}
          ListHeaderComponent={headerElement}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  profileHeader: {
    paddingBottom: 4,
  },
  batchBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  batchText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  bannerWrap: {
    width: "100%",
    height: 112,
    overflow: "hidden",
  },
  profileCard: {
    marginHorizontal: 12,
    marginTop: -26,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  identityCol: {
    flex: 1,
    gap: 3,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  userName: {
    fontSize: 18,
    fontWeight: "800",
    flexShrink: 1,
  },
  premiumBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  premiumText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  userAccount: {
    fontSize: 12,
  },
  profileActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryActionBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  primaryActionText: {
    fontSize: 13,
    fontWeight: "700",
  },
  secondaryActionBtn: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statCell: {
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 2,
  },
  statVal: {
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  statLbl: {
    fontSize: 11,
  },
  bioWrap: {
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  bioText: {
    fontSize: 13,
    lineHeight: 19,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  wsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wsTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  wsList: {
    gap: 6,
    marginTop: 4,
  },
  wsRow: {
    flexDirection: "row",
    gap: 10,
  },
  wsKey: {
    width: 68,
    fontSize: 12,
  },
  wsVal: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  tabsWrap: {
    marginTop: 6,
  },
  bookmarkControls: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 4,
    gap: 8,
  },
  restrictSeg: {
    width: 126,
  },
})
