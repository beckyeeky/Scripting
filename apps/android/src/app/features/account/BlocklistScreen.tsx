import React, { useEffect, useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  blockTag,
  clearBlockedTags,
  clearBlockedUsers,
  loadBlocklist,
  onBlocklistChanged,
  unblockTag,
  unblockUser,
  type BlocklistData,
} from "../../../../../../Pix-Scripting/src/store/blocklist"
import {
  EmptyView,
  HeaderIconButton,
  PixAvatar,
  ScreenHeader,
  SectionCard,
  SectionHeader,
  SegmentedControl,
  ThemedTextInput,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

type BlockTab = "tags" | "users"

export function BlocklistScreen() {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [tab, setTab] = useState<BlockTab>("tags")
  const [data, setData] = useState<BlocklistData>(() => loadBlocklist())
  const [tagInput, setTagInput] = useState("")

  useEffect(() => {
    setData(loadBlocklist())
    return onBlocklistChanged(() => {
      setData(loadBlocklist())
    })
  }, [])

  function handleAddTag() {
    const clean = tagInput.trim()
    if (!clean) return
    blockTag(clean)
    setTagInput("")
    try {
      triggerHaptic("light")
    } catch {}
    overlay.showToast(`已屏蔽标签「${clean}」`, "success")
  }

  async function handleClearCurrent() {
    if (tab === "tags") {
      if (data.blockedTags.length === 0) return
      const ok = await overlay.confirm({
        title: "清空屏蔽标签",
        message: `确定移除全部 ${data.blockedTags.length} 个屏蔽标签吗？`,
        confirmLabel: "清空",
        destructive: true,
      })
      if (!ok) return
      clearBlockedTags()
      overlay.showToast("已清空屏蔽标签", "info")
    } else {
      if (data.blockedUsers.length === 0) return
      const ok = await overlay.confirm({
        title: "清空屏蔽画师",
        message: `确定解除屏蔽全部 ${data.blockedUsers.length} 位画师吗？`,
        confirmLabel: "清空",
        destructive: true,
      })
      if (!ok) return
      clearBlockedUsers()
      overlay.showToast("已清空屏蔽画师", "info")
    }
  }

  const hasClearable =
    tab === "tags" ? data.blockedTags.length > 0 : data.blockedUsers.length > 0

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="屏蔽管理"
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          hasClearable ? (
            <HeaderIconButton
              label="清空"
              color={colors.danger}
              onPress={() => void handleClearCurrent()}
            />
          ) : null
        }
        bottom={
          <View style={styles.segWrap}>
            <SegmentedControl<BlockTab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "tags", label: `屏蔽标签 (${data.blockedTags.length})` },
                { value: "users", label: `屏蔽画师 (${data.blockedUsers.length})` },
              ]}
            />
          </View>
        }
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: effectiveBottomInset(insets) + 28 },
        ]}
      >
        {tab === "tags" ? (
          <>
            <SectionHeader title="新增屏蔽标签" />
            <SectionCard style={styles.addCard}>
              <View style={styles.addRow}>
                <ThemedTextInput
                  value={tagInput}
                  onChangeText={setTagInput}
                  placeholder="输入标签名（精确匹配）"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.flexInput}
                  onSubmitEditing={handleAddTag}
                />
                <Pressable
                  onPress={handleAddTag}
                  disabled={!tagInput.trim()}
                  style={[
                    styles.addBtn,
                    { backgroundColor: accent },
                    !tagInput.trim() && { opacity: 0.45 },
                  ]}
                >
                  <Text style={styles.addBtnText}>添加</Text>
                </Pressable>
              </View>
            </SectionCard>

            <SectionHeader title={`已屏蔽标签 (${data.blockedTags.length})`} />
            {data.blockedTags.length === 0 ? (
              <EmptyView
                title="暂无屏蔽标签"
                subtitle="添加后的标签将在探索、排行、搜索和关注动态中自动隐藏。"
              />
            ) : (
              <SectionCard>
                {data.blockedTags.map((tag, idx) => (
                  <View
                    key={tag}
                    style={[
                      styles.itemRow,
                      idx < data.blockedTags.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.separator,
                      },
                    ]}
                  >
                    <Text style={[styles.tagText, { color: colors.text }]} numberOfLines={1}>
                      #{tag}
                    </Text>
                    <Pressable
                      onPress={() => {
                        unblockTag(tag)
                        overlay.showToast(`已取消屏蔽「${tag}」`, "info")
                      }}
                      hitSlop={8}
                      style={[styles.removeBtn, { backgroundColor: `${colors.danger}16` }]}
                    >
                      <Text style={[styles.removeBtnText, { color: colors.danger }]}>移除</Text>
                    </Pressable>
                  </View>
                ))}
              </SectionCard>
            )}
          </>
        ) : (
          <>
            <SectionHeader title={`已屏蔽画师 (${data.blockedUsers.length})`} />
            {data.blockedUsers.length === 0 ? (
              <EmptyView
                title="暂无屏蔽画师"
                subtitle="在作品详情页或画师主页点击屏蔽后，画师会出现在此处。"
              />
            ) : (
              <SectionCard>
                {data.blockedUsers.map((user, idx) => (
                  <View
                    key={user.id}
                    style={[
                      styles.itemRow,
                      idx < data.blockedUsers.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.separator,
                      },
                    ]}
                  >
                    <Pressable
                      style={styles.userMain}
                      onPress={() => nav.push({ name: "user", id: user.id })}
                    >
                      <PixAvatar url={user.avatarURL} name={user.name} size={38} />
                      <View style={styles.userMeta}>
                        <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                          {user.name}
                        </Text>
                        <Text style={[styles.userSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          {user.account ? `@${user.account} · ` : ""}UID {user.id}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        unblockUser(user.id)
                        overlay.showToast(`已取消屏蔽「${user.name}」`, "info")
                      }}
                      hitSlop={8}
                      style={[styles.removeBtn, { backgroundColor: `${colors.danger}16` }]}
                    >
                      <Text style={[styles.removeBtnText, { color: colors.danger }]}>解除</Text>
                    </Pressable>
                  </View>
                ))}
              </SectionCard>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  segWrap: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  scrollContent: {
    paddingTop: 4,
  },
  addCard: {
    padding: 12,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  flexInput: {
    flex: 1,
  },
  addBtn: {
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  tagText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  userMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  userMeta: {
    flex: 1,
    gap: 2,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
  },
  userSub: {
    fontSize: 12,
  },
  removeBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
  },
  removeBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
})
