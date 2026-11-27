import React, { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  blockTag,
  blockUser,
  isTagBlocked,
  isUserBlocked,
  loadBlocklist,
  onBlocklistChanged,
  unblockTag,
  unblockUser,
} from "../../../../../Pix-Scripting/src/store/blocklist"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import { SectionCard, SectionHeader, SettingRow } from "../components/FormControls"
import { effectiveBottomInset, useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"
import type { BlockWorkTarget } from "./types"

export function BlockWorkSheet({
  target,
  onToast,
}: {
  target: BlockWorkTarget
  onToast?: (message: string, tone?: "info" | "success" | "error") => void
}) {
  const { colors } = useAppTheme()
  const insets = useSafeInsets()
  const [blocklist, setBlocklist] = useState(() => loadBlocklist())

  useEffect(() => {
    return onBlocklistChanged(() => setBlocklist(loadBlocklist()))
  }, [])

  const user = target.user
  const userBlocked = user ? isUserBlocked(user.id, blocklist.blockedUsers) : false
  const tags = Array.from(new Set((target.tags ?? []).filter((t) => Boolean(t && t.trim()))))

  function toggleUserBlock() {
    if (!user) return
    try {
      triggerHaptic("selection")
    } catch {}
    if (userBlocked) {
      unblockUser(user.id)
      onToast?.(`已取消屏蔽画师 ${user.name}`, "info")
    } else {
      blockUser(user)
      onToast?.(`已屏蔽画师 ${user.name}`, "success")
    }
  }

  function toggleTagBlock(tag: string) {
    try {
      triggerHaptic("selection")
    } catch {}
    if (isTagBlocked(tag, blocklist.blockedTags)) {
      unblockTag(tag)
      onToast?.(`已取消屏蔽标签 #${tag}`, "info")
    } else {
      blockTag(tag)
      onToast?.(`已屏蔽标签 #${tag}`, "success")
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: effectiveBottomInset(insets) + 20 }}
    >
      {user ? (
        <>
          <SectionHeader title="创作者屏蔽" />
          <SectionCard>
            <SettingRow
              title={user.name}
              subtitle={user.account ? `@${user.account}` : `UID ${user.id}`}
              isLast={true}
              onPress={toggleUserBlock}
              right={
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: userBlocked ? colors.danger : colors.fill },
                  ]}
                >
                  <Text style={[styles.pillText, { color: userBlocked ? "#FFFFFF" : colors.text }]}>
                    {userBlocked ? "已屏蔽" : "屏蔽"}
                  </Text>
                </View>
              }
            />
          </SectionCard>
        </>
      ) : null}

      {tags.length > 0 ? (
        <>
          <SectionHeader title="标签屏蔽" />
          <View style={styles.tagGrid}>
            {tags.map((tag) => {
              const blocked = isTagBlocked(tag, blocklist.blockedTags)
              return (
                <Pressable
                  key={tag}
                  onPress={() => toggleTagBlock(tag)}
                  style={[
                    styles.tagBtn,
                    {
                      backgroundColor: blocked ? colors.danger : colors.surface,
                      borderColor: blocked ? colors.danger : colors.glassBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      { color: blocked ? "#FFFFFF" : colors.text },
                    ]}
                  >
                    {blocked ? "✓ " : "+ "}#{tag}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
  },
  tagGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  tagBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: {
    fontSize: 13,
    fontWeight: "500",
  },
})
