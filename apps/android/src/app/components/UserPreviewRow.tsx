import React, { memo, useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { followUser, unfollowUser } from "../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../Pix-Scripting/src/api/session"
import { thumbUrlOf } from "../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import { cacheIllust } from "../../../../../Pix-Scripting/src/store/illustCache"
import {
  getEffectiveFollowState,
  onUserFollowChanged,
} from "../../../../../Pix-Scripting/src/store/userFollow"
import type { PixivUserPreview } from "../../../../../Pix-Scripting/src/types"
import { useAppNav } from "../navigation/NavContext"
import { useOverlay } from "../overlay/OverlayHost"
import { useAppTheme } from "../theme/ThemeProvider"
import { PixAvatar, PixImage } from "./PixImage"

export const UserPreviewRow = memo(function UserPreviewRow({
  preview,
  onSelectUser,
}: {
  preview: PixivUserPreview
  onSelectUser?: (userId: number) => void
}) {
  const { colors, accent } = useAppTheme()
  const nav = useAppNav()
  const overlay = useOverlay()
  const user = preview.user

  const [followed, setFollowed] = useState<boolean>(
    () => getEffectiveFollowState(user.id, Boolean(user.is_followed)).followed,
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFollowed(getEffectiveFollowState(user.id, Boolean(user.is_followed)).followed)
    return onUserFollowChanged((uid, next) => {
      if (uid === user.id) setFollowed(next)
    })
  }, [user.id, user.is_followed])

  async function toggleFollow() {
    if (busy || user.id === session.userID) return
    const next = !followed
    setFollowed(next)
    setBusy(true)
    try {
      triggerHaptic("selection")
    } catch {}
    try {
      await session.call((token) =>
        next ? followUser(user.id, "public", token) : unfollowUser(user.id, token),
      )
    } catch (e: any) {
      setFollowed(!next)
      overlay.showToast(e?.message ?? "关注操作失败", "error")
    } finally {
      setBusy(false)
    }
  }

  function openUser() {
    if (onSelectUser) {
      onSelectUser(user.id)
    } else {
      nav.push({ name: "user", id: user.id, seed: user })
    }
  }

  const works = (preview.illusts ?? []).slice(0, 3)

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.glassBorder },
      ]}
    >
      <View style={styles.header}>
        <Pressable onPress={openUser} style={styles.userInfo}>
          <PixAvatar url={user.profile_image_urls?.medium} name={user.name} size={42} />
          <View style={styles.nameWrap}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {user.name}
            </Text>
            <Text style={[styles.account, { color: colors.textSecondary }]} numberOfLines={1}>
              @{user.account}
            </Text>
          </View>
        </Pressable>

        {user.id !== session.userID ? (
          <Pressable
            onPress={() => void toggleFollow()}
            disabled={busy}
            style={[
              styles.followBtn,
              {
                backgroundColor: followed ? colors.fill : accent,
                borderColor: followed ? colors.glassBorder : accent,
              },
            ]}
          >
            <Text
              style={[
                styles.followBtnText,
                { color: followed ? colors.text : "#FFFFFF" },
              ]}
            >
              {followed ? "已关注" : "关注"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {works.length > 0 ? (
        <View style={styles.thumbRow}>
          {works.map((illust) => (
            <Pressable
              key={illust.id}
              onPress={() => {
                cacheIllust(illust)
                nav.push({ name: "illust", id: illust.id, seed: illust })
              }}
              style={styles.thumbCell}
            >
              <PixImage
                url={thumbUrlOf(illust)}
                borderRadius={8}
                style={styles.thumbImage}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 5,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  userInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  nameWrap: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
  },
  account: {
    fontSize: 12,
  },
  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  followBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  thumbRow: {
    flexDirection: "row",
    gap: 6,
  },
  thumbCell: {
    flex: 1,
    aspectRatio: 1,
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
})
