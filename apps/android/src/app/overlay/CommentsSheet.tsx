import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  commentReplies,
  comments,
  nextComments,
  novelCommentReplies,
  novelComments,
  postComment,
  postNovelComment,
} from "../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../Pix-Scripting/src/api/session"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import type { PixivComment } from "../../../../../Pix-Scripting/src/types"
import { ActionButton, ThemedTextInput } from "../components/FormControls"
import { PixAvatar } from "../components/PixImage"
import { EmptyView, ErrorView, InlineFooterLoader } from "../components/StateViews"
import { useAppNav } from "../navigation/NavContext"
import { effectiveBottomInset, useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"

function formatCommentDate(raw: string): string {
  if (!raw) return ""
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    const h = String(d.getHours()).padStart(2, "0")
    const min = String(d.getMinutes()).padStart(2, "0")
    return `${d.getFullYear()}-${m}-${day} ${h}:${min}`
  } catch {
    return raw.slice(0, 10)
  }
}

export function CommentsSheet({
  type,
  id,
  onClose,
  onToast,
}: {
  type: "illust" | "novel"
  id: number
  onClose: () => void
  onToast?: (message: string, tone?: "info" | "success" | "error") => void
}) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()

  const [items, setItems] = useState<PixivComment[]>([])
  const [nextURL, setNextURL] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repliesMap, setRepliesMap] = useState<Record<number, PixivComment[]>>({})
  const [loadingReplyIds, setLoadingReplyIds] = useState<Record<number, boolean>>({})

  const [draft, setDraft] = useState("")
  const [replyTo, setReplyTo] = useState<PixivComment | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fetchFirst = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await session.call((token) =>
        type === "illust" ? comments(id, token) : novelComments(id, token),
      )
      setItems(page.items ?? [])
      setNextURL(page.nextURL ?? null)
    } catch (e: any) {
      setError(e?.message ?? "无法加载评论")
    } finally {
      setLoading(false)
    }
  }, [type, id])

  useEffect(() => {
    void fetchFirst()
  }, [fetchFirst])

  async function handleLoadMore() {
    if (!nextURL || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await session.call((token) => nextComments(nextURL, token))
      setItems((prev) => {
        const seen = new Set(prev.map((c) => c.id))
        const added = (page.items ?? []).filter((c) => !seen.has(c.id))
        return added.length > 0 ? [...prev, ...added] : prev
      })
      setNextURL(page.nextURL ?? null)
    } catch {
      // Keep existing list on pagination failure
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleExpandReplies(commentId: number) {
    if (loadingReplyIds[commentId]) return
    setLoadingReplyIds((prev) => ({ ...prev, [commentId]: true }))
    try {
      const page = await session.call((token) =>
        type === "illust"
          ? commentReplies(commentId, token)
          : novelCommentReplies(commentId, token),
      )
      setRepliesMap((prev) => ({ ...prev, [commentId]: page.items ?? [] }))
    } catch (e: any) {
      onToast?.(e?.message ?? "加载回复失败", "error")
    } finally {
      setLoadingReplyIds((prev) => ({ ...prev, [commentId]: false }))
    }
  }

  async function handleSend() {
    const text = draft.trim()
    if (!text || submitting) return
    setSubmitting(true)
    try {
      const parentId = replyTo?.id ?? null
      await session.call((token) =>
        type === "illust"
          ? postComment(id, text, parentId, token)
          : postNovelComment(id, text, parentId, token),
      )
      try {
        triggerHaptic("success")
      } catch {}
      setDraft("")
      setReplyTo(null)
      onToast?.("评论已发布", "success")
      await fetchFirst()
    } catch (e: any) {
      onToast?.(e?.message ?? "发送评论失败", "error")
    } finally {
      setSubmitting(false)
    }
  }

  function openAuthor(userId: number) {
    onClose()
    nav.push({ name: "user", id: userId })
  }

  function renderCommentRow(item: PixivComment, isReply = false) {
    const replies = repliesMap[item.id]
    const hasReplies = Boolean(item.has_replies || (item.reply_count && item.reply_count > 0))

    return (
      <View
        key={`${isReply ? "rep" : "cmt"}-${item.id}`}
        style={[
          styles.commentRow,
          isReply && styles.replyRow,
          { borderBottomColor: colors.separator },
        ]}
      >
        <Pressable onPress={() => openAuthor(item.user.id)}>
          <PixAvatar
            url={item.user?.profile_image_urls?.medium}
            name={item.user?.name}
            size={isReply ? 28 : 34}
          />
        </Pressable>
        <View style={styles.commentBody}>
          <View style={styles.commentHeader}>
            <Pressable onPress={() => openAuthor(item.user.id)} style={{ flex: 1 }}>
              <Text style={[styles.authorName, { color: colors.text }]} numberOfLines={1}>
                {item.user?.name || "用户"}
              </Text>
            </Pressable>
            <Text style={[styles.dateText, { color: colors.textTertiary }]}>
              {formatCommentDate(item.date)}
            </Text>
          </View>
          {item.comment ? (
            <Text style={[styles.commentText, { color: colors.text }]}>{item.comment}</Text>
          ) : item.stamp ? (
            <Text style={[styles.commentText, { color: colors.textSecondary }]}>
              [表情贴纸 #{item.stamp.stamp_id}]
            </Text>
          ) : null}

          <View style={styles.commentActions}>
            {!isReply ? (
              <Pressable onPress={() => setReplyTo(item)} hitSlop={8}>
                <Text style={[styles.actionLink, { color: accent }]}>回复</Text>
              </Pressable>
            ) : null}
            {!isReply && hasReplies && !replies ? (
              <Pressable onPress={() => void handleExpandReplies(item.id)} hitSlop={8}>
                <Text style={[styles.actionLink, { color: colors.textSecondary }]}>
                  {loadingReplyIds[item.id] ? "加载回复中…" : "查看回复"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {replies && replies.length > 0 ? (
            <View style={[styles.repliesBox, { backgroundColor: colors.fill }]}>
              {replies.map((rep) => renderCommentRow(rep, true))}
            </View>
          ) : null}
        </View>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      ) : error ? (
        <ErrorView message={error} onRetry={() => void fetchFirst()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => renderCommentRow(item, false)}
          ListEmptyComponent={<EmptyView title="暂无评论" subtitle="来发表第一条评论吧" />}
          ListFooterComponent={
            items.length > 0 ? (
              <InlineFooterLoader
                loading={loadingMore}
                hasMore={Boolean(nextURL)}
                onLoadMore={() => void handleLoadMore()}
              />
            ) : null
          }
          onEndReached={() => {
            if (nextURL && !loadingMore) void handleLoadMore()
          }}
          onEndReachedThreshold={0.5}
          style={styles.list}
        />
      )}

      <View
        style={[
          styles.composer,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.separator,
            paddingBottom: effectiveBottomInset(insets) + 10,
          },
        ]}
      >
        {replyTo ? (
          <View style={styles.replyBanner}>
            <Text style={[styles.replyBannerText, { color: colors.textSecondary }]} numberOfLines={1}>
              回复 {replyTo.user?.name}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Text style={[styles.actionLink, { color: accent }]}>取消</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <ThemedTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={replyTo ? `回复 ${replyTo.user?.name}…` : "写下评论…"}
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={() => void handleSend()}
            style={{ flex: 1 }}
          />
          <ActionButton
            title="发送"
            onPress={() => void handleSend()}
            loading={submitting}
            disabled={!draft.trim()}
            style={{ paddingHorizontal: 16 }}
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  list: {
    flex: 1,
  },
  commentRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  replyRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 0,
  },
  commentBody: {
    flex: 1,
    gap: 4,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  authorName: {
    fontSize: 13,
    fontWeight: "600",
  },
  dateText: {
    fontSize: 11,
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  commentActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 2,
  },
  actionLink: {
    fontSize: 12,
    fontWeight: "600",
  },
  repliesBox: {
    marginTop: 6,
    borderRadius: 10,
    overflow: "hidden",
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  replyBannerText: {
    fontSize: 12,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
})
