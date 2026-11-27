import React, { memo, useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import {
  addWatchlistSeries,
  deleteWatchlistSeries,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import { onWatchlistChanged } from "../../../../../../Pix-Scripting/src/store/bookmarkSync"
import { recordWorkSeriesAssociation } from "../../../../../../Pix-Scripting/src/store/seriesCache"
import type { PixivWatchlistSeries } from "../../../../../../Pix-Scripting/src/types"
import { PixAvatar, PixImage } from "../../components/PixImage"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { useAppTheme } from "../../theme/ThemeProvider"

function formatUpdatedDate(raw?: string | null): string {
  if (!raw) return ""
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export interface WatchlistSeriesCardProps {
  series: PixivWatchlistSeries
  kind: "manga" | "novel"
  onUnwatched?: (seriesId: number) => void
}

export const WatchlistSeriesCard = memo(function WatchlistSeriesCard({
  series,
  kind,
  onUnwatched,
}: WatchlistSeriesCardProps) {
  const { colors, accent, accentSoft } = useAppTheme()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [watched, setWatched] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setWatched(true)
    return onWatchlistChanged((changedId, changedKind, nextWatched) => {
      if (changedId === series.id && changedKind === kind) {
        setWatched(nextWatched)
      }
    })
  }, [series.id, kind])

  function handleOpenSeries() {
    if (series.latest_content_id) {
      try {
        recordWorkSeriesAssociation(
          series.latest_content_id,
          kind,
          series.id,
          series.title,
        )
      } catch {}
    }
    nav.push({ name: "series", kind, id: series.id })
  }

  async function handleToggleWatch() {
    if (busy) return
    const next = !watched
    setBusy(true)
    setWatched(next)
    try {
      triggerHaptic("selection")
    } catch {}
    try {
      await session.call((token) =>
        next
          ? addWatchlistSeries(series.id, kind, token)
          : deleteWatchlistSeries(series.id, kind, token),
      )
      overlay.showToast(next ? "已加入追更列表" : "已移出追更列表", "info")
      if (!next) {
        onUnwatched?.(series.id)
      }
    } catch (e: any) {
      setWatched(!next)
      overlay.showToast(e?.message ?? "追更状态更新失败", "error")
    } finally {
      setBusy(false)
    }
  }

  const updatedLabel = formatUpdatedDate(series.last_published_content_datetime)

  return (
    <Pressable
      onPress={handleOpenSeries}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.glassBorder,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={[styles.coverWrap, { backgroundColor: colors.fill }]}>
        {series.url ? (
          <PixImage url={series.url} resizeMode="cover" borderRadius={10} style={styles.coverImg} />
        ) : (
          <View style={[styles.coverPlaceholder, { backgroundColor: accentSoft }]}>
            <Text style={[styles.coverInitial, { color: accent }]}>
              {kind === "manga" ? "漫" : "文"}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.topMeta}>
          <View style={[styles.kindBadge, { backgroundColor: accentSoft }]}>
            <Text style={[styles.kindText, { color: accent }]}>
              {kind === "manga" ? "漫画系列" : "小说系列"} · 共 {series.published_content_count} 话
            </Text>
          </View>
          {updatedLabel ? (
            <Text style={[styles.dateText, { color: colors.textTertiary }]} numberOfLines={1}>
              {updatedLabel}
            </Text>
          ) : null}
        </View>

        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {series.title}
        </Text>

        {series.mask_text ? (
          <Text style={[styles.maskText, { color: colors.orange }]} numberOfLines={1}>
            {series.mask_text}
          </Text>
        ) : null}

        <View style={styles.footer}>
          {series.user ? (
            <Pressable
              onPress={() =>
                nav.push({ name: "user", id: series.user!.id, seed: series.user! })
              }
              style={styles.authorRow}
            >
              <PixAvatar
                url={series.user.profile_image_urls?.medium}
                name={series.user.name}
                size={22}
              />
              <Text style={[styles.authorName, { color: colors.textSecondary }]} numberOfLines={1}>
                {series.user.name}
              </Text>
            </Pressable>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <Pressable
            onPress={() => void handleToggleWatch()}
            disabled={busy}
            hitSlop={6}
            style={[
              styles.watchBtn,
              {
                backgroundColor: watched ? colors.fill : accent,
                borderColor: watched ? colors.glassBorder : accent,
                opacity: busy ? 0.6 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.watchBtnText,
                { color: watched ? colors.textSecondary : "#FFFFFF" },
              ]}
            >
              {watched ? "已追更" : "追更"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  coverWrap: {
    width: 78,
    height: 104,
    borderRadius: 10,
    overflow: "hidden",
  },
  coverImg: {
    width: "100%",
    height: "100%",
  },
  coverPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  coverInitial: {
    fontSize: 22,
    fontWeight: "800",
  },
  body: {
    flex: 1,
    justifyContent: "space-between",
    gap: 6,
  },
  topMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  kindBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  kindText: {
    fontSize: 11,
    fontWeight: "600",
  },
  dateText: {
    fontSize: 11,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  maskText: {
    fontSize: 12,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  authorRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  authorName: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  watchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  watchBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
})
