import React, { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { userDetail } from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { SCRIPT_VERSION } from "../../../../../../Pix-Scripting/src/config"
import { DownloadTaskManager } from "../../../../../../Pix-Scripting/src/downloader/downloadTaskManager"
import { loadBlocklist, onBlocklistChanged } from "../../../../../../Pix-Scripting/src/store/blocklist"
import {
  getCustomAIProviderName,
  isCustomAIConfigured,
  loadCustomAIProfile,
  onCustomAIConfigChanged,
} from "../../../../../../Pix-Scripting/src/store/customAI"
import { historyCount, onHistoryChanged } from "../../../../../../Pix-Scripting/src/store/history"
import type { PixivUserDetail } from "../../../../../../Pix-Scripting/src/types"
import {
  HeaderIconButton,
  PixAvatar,
  ScreenHeader,
  SectionCard,
  SectionHeader,
  SettingRow,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { AccountSwitcherSheet } from "./AccountSwitcherSheet"
import { openReverseImageSearch } from "./reverseImageSearchEntry"

export function MoreScreen() {
  const { colors, accent, accentSoft, settings } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [authTick, setAuthTick] = useState(0)
  const [profileDetail, setProfileDetail] = useState<PixivUserDetail | null>(null)
  const [totalHistory, setTotalHistory] = useState<number>(() => historyCount())
  const [blockedSummary, setBlockedSummary] = useState<string>(() => {
    const b = loadBlocklist()
    return `${b.blockedTags.length} 标签 · ${b.blockedUsers.length} 画师`
  })
  const [aiSummary, setAiSummary] = useState<string>(() => {
    const p = loadCustomAIProfile()
    return isCustomAIConfigured()
      ? `${getCustomAIProviderName(p)} · ${p.general.model}`
      : p.enabled
        ? "待完善"
        : "未启用"
  })
  const [activeDownloads, setActiveDownloads] = useState<number>(
    () =>
      DownloadTaskManager.getAllTasks().filter(
        (t) => t.status === "running" || t.status === "queued" || t.status === "paused",
      ).length,
  )

  useEffect(() => {
    const unsubAuth = session.onAuthChanged(() => {
      setAuthTick((v) => v + 1)
      setProfileDetail(null)
    })
    const unsubHist = onHistoryChanged(() => setTotalHistory(historyCount()))
    const unsubBlock = onBlocklistChanged(() => {
      const b = loadBlocklist()
      setBlockedSummary(`${b.blockedTags.length} 标签 · ${b.blockedUsers.length} 画师`)
    })
    const unsubAI = onCustomAIConfigChanged((p) => {
      setAiSummary(
        isCustomAIConfigured()
          ? `${getCustomAIProviderName(p)} · ${p.general.model}`
          : p.enabled
            ? "待完善"
            : "未启用",
      )
    })
    const unsubDl = DownloadTaskManager.addListener(() => {
      setActiveDownloads(
        DownloadTaskManager.getAllTasks().filter(
          (t) => t.status === "running" || t.status === "queued" || t.status === "paused",
        ).length,
      )
    })
    return () => {
      unsubAuth()
      unsubHist()
      unsubBlock()
      unsubAI()
      unsubDl()
    }
  }, [])

  // Fetch user quick stats in background
  useEffect(() => {
    void authTick
    const uid = session.userID
    if (!uid) return
    let active = true
    void session
      .call((token) => userDetail(uid, token))
      .then((detail) => {
        if (active && detail) setProfileDetail(detail)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [authTick])

  const user = session.user
  const uid = session.userID
  const accountsCount = session.getAllAccounts().length
  const avatarUrl =
    profileDetail?.user?.profile_image_urls?.medium ||
    user?.profile_image_urls?.px_170x170 ||
    user?.profile_image_urls?.px_50x50 ||
    null

  function openAccountSwitcher() {
    overlay.presentSheet({
      id: "account-switcher",
      title: "多账号管理",
      fullHeight: true,
      render: (close) => (
        <AccountSwitcherSheet
          onClose={close}
          onAccountChanged={() => setAuthTick((v) => v + 1)}
        />
      ),
    })
  }

  function openReverseImageSearchSheet() {
    openReverseImageSearch(overlay)
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="我的"
        right={<HeaderIconButton label="设置" onPress={() => nav.push({ name: "settings" })} />}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: effectiveBottomInset(insets) + 28 },
        ]}
      >
        {/* Profile Hero Card */}
        <SectionCard style={styles.profileCard}>
          <Pressable
            onPress={() => {
              if (uid) nav.push({ name: "user", id: uid })
              else openAccountSwitcher()
            }}
            style={styles.profileTop}
          >
            <PixAvatar url={avatarUrl} name={user?.name} size={58} />
            <View style={styles.profileMeta}>
              <View style={styles.nameRow}>
                <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                  {user?.name || "未登录用户"}
                </Text>
                {user?.is_premium ? (
                  <View style={[styles.proBadge, { backgroundColor: `${colors.orange}24` }]}>
                    <Text style={[styles.proBadgeText, { color: colors.orange }]}>PRO</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.userSub, { color: colors.textSecondary }]} numberOfLines={1}>
                {user?.account ? `@${user.account}` : "点击查看个人主页"}
                {uid ? ` · UID ${uid}` : ""}
              </Text>
            </View>
            <Pressable
              onPress={openAccountSwitcher}
              hitSlop={8}
              style={[styles.switchPill, { backgroundColor: accentSoft }]}
            >
              <Text style={[styles.switchPillText, { color: accent }]}>切号</Text>
            </Pressable>
          </Pressable>

          {/* Quick Stats Bar */}
          <View style={[styles.statsRow, { borderTopColor: colors.separator }]}>
            <Pressable
              style={styles.statItem}
              onPress={() => nav.push({ name: "userConnections", kind: "following", title: "我的关注" })}
            >
              <Text style={[styles.statVal, { color: colors.text }]}>
                {profileDetail?.profile?.total_follow_users ?? "—"}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>关注</Text>
            </Pressable>
            <Pressable
              style={styles.statItem}
              onPress={() => nav.push({ name: "library" })}
            >
              <Text style={[styles.statVal, { color: colors.text }]}>
                {profileDetail?.profile?.total_illust_bookmarks_public ?? "—"}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>公开收藏</Text>
            </Pressable>
            <Pressable
              style={styles.statItem}
              onPress={() => nav.push({ name: "history" })}
            >
              <Text style={[styles.statVal, { color: colors.text }]}>{totalHistory}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>本地足迹</Text>
            </Pressable>
            <Pressable
              style={styles.statItem}
              onPress={() => nav.push({ name: "userWorks", title: "我的作品" })}
            >
              <Text style={[styles.statVal, { color: colors.text }]}>
                {profileDetail?.profile
                  ? (profileDetail.profile.total_illusts || 0) +
                    (profileDetail.profile.total_manga || 0) +
                    (profileDetail.profile.total_novels || 0)
                  : "—"}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>作品</Text>
            </Pressable>
          </View>
        </SectionCard>

        {/* Personal Content & Library */}
        <SectionHeader title="收藏、足迹与离线" />
        <SectionCard>
          <SettingRow
            title="我的收藏"
            subtitle="插画·漫画、小说与 Pixivision 特辑"
            icon="♥"
            iconColor={colors.pink}
            showChevron={true}
            onPress={() => nav.push({ name: "library" })}
          />
          <SettingRow
            title="浏览记录"
            icon="历"
            iconColor={accent}
            value={totalHistory > 0 ? `${totalHistory} 条` : undefined}
            showChevron={true}
            onPress={() => nav.push({ name: "history" })}
          />
          <SettingRow
            title="我的足迹统计"
            subtitle="热力图、24 小时节律、高频标签与偏好画像"
            icon="统"
            iconColor={colors.purple}
            showChevron={true}
            onPress={() => nav.push({ name: "historyAnalytics" })}
          />
          {!settings.hideNovels ? (
            <SettingRow
              title="小说书签与离线书库"
              subtitle="阅读进度书签、离线缓存与译文管理"
              icon="书"
              iconColor={colors.orange}
              showChevron={true}
              onPress={() => nav.push({ name: "novelLibrary" })}
            />
          ) : null}
          <SettingRow
            title="下载与文件管理"
            subtitle="任务队列、本地下载文件分类与创作者目录"
            icon="下"
            iconColor={colors.green}
            value={activeDownloads > 0 ? `${activeDownloads} 进行中` : undefined}
            showChevron={true}
            onPress={() => nav.push({ name: "downloadManager" })}
          />
          <SettingRow
            title="以图搜图 (SauceNAO)"
            subtitle="相册选图溯源 Pixiv 原画与画师"
            icon="搜"
            iconColor={accent}
            showChevron={true}
            isLast={true}
            onPress={openReverseImageSearchSheet}
          />
        </SectionCard>

        {/* Social & Works */}
        <SectionHeader title="社交与互动" />
        <SectionCard>
          <SettingRow
            title="我的关注"
            icon="关"
            iconColor={accent}
            showChevron={true}
            onPress={() => nav.push({ name: "userConnections", kind: "following", title: "我的关注" })}
          />
          <SettingRow
            title="我的粉丝"
            icon="粉"
            iconColor={colors.pink}
            showChevron={true}
            onPress={() => nav.push({ name: "userConnections", kind: "follower", title: "我的粉丝" })}
          />
          <SettingRow
            title="我的好友 (MyPixiv)"
            icon="友"
            iconColor={colors.green}
            showChevron={true}
            onPress={() => nav.push({ name: "userConnections", kind: "mypixiv", title: "我的好友" })}
          />
          <SettingRow
            title="我的作品"
            icon="作"
            iconColor={colors.orange}
            showChevron={true}
            onPress={() => nav.push({ name: "userWorks", title: "我的作品" })}
          />
          <SettingRow
            title="我的通知"
            icon="铃"
            iconColor={colors.purple}
            showChevron={true}
            isLast={true}
            onPress={() => nav.push({ name: "notifications" })}
          />
        </SectionCard>

        {/* System, AI & Account */}
        <SectionHeader title="偏好、智能助手与账号" />
        <SectionCard>
          <SettingRow
            title="屏蔽管理"
            icon="屏"
            iconColor={colors.danger}
            value={blockedSummary}
            showChevron={true}
            onPress={() => nav.push({ name: "blocklist" })}
          />
          <SettingRow
            title="AI 智能助手配置"
            icon="AI"
            iconColor={colors.purple}
            value={aiSummary}
            showChevron={true}
            onPress={() => nav.push({ name: "customAI" })}
          />
          <SettingRow
            title="应用设置"
            subtitle="过滤、主题、画质、反代网关与跨设备同步"
            icon="设"
            iconColor={accent}
            showChevron={true}
            onPress={() => nav.push({ name: "settings" })}
          />
          <SettingRow
            title="多账号管理"
            icon="账"
            iconColor={colors.green}
            value={`${accountsCount} 个账号`}
            showChevron={true}
            onPress={openAccountSwitcher}
          />
          <SettingRow
            title="导入 iOS 配置 / Token"
            subtitle="兼容 iOS 同步包、ZIP 备份与 Refresh Token"
            icon="导"
            iconColor={colors.orange}
            showChevron={true}
            onPress={() =>
              overlay.openIosImport({
                onImported: (msg) => {
                  overlay.showToast(msg, "success")
                  setAuthTick((v) => v + 1)
                },
              })
            }
          />
          <SettingRow
            title="关于应用"
            icon="i"
            iconColor={colors.textSecondary}
            value={`v${SCRIPT_VERSION || "1.8.14.4"}`}
            showChevron={true}
            isLast={true}
            onPress={() => nav.push({ name: "about" })}
          />
        </SectionCard>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingTop: 10,
  },
  profileCard: {
    overflow: "hidden",
  },
  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  profileMeta: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  userName: {
    fontSize: 18,
    fontWeight: "800",
    flexShrink: 1,
  },
  proBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  userSub: {
    fontSize: 12,
  },
  switchPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  switchPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  statsRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statVal: {
    fontSize: 15,
    fontWeight: "800",
  },
  statLabel: {
    fontSize: 11,
  },
})
