import React from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { useAppTheme } from "../theme/ThemeProvider"

export function LoadingView({ message = "加载中…" }: { message?: string }) {
  const { colors, accent } = useAppTheme()
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={accent} />
      <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
    </View>
  )
}

export function ErrorView({
  message,
  onRetry,
  retryLabel = "重试",
}: {
  message: string
  onRetry?: () => void
  retryLabel?: string
}) {
  const { colors, accent } = useAppTheme()
  return (
    <View style={styles.center}>
      <Text style={[styles.icon, { color: colors.danger }]}>!</Text>
      <Text style={[styles.title, { color: colors.text }]}>加载遇到问题</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.retryBtn, { backgroundColor: accent }]}
        >
          <Text style={styles.retryBtnText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function EmptyView({
  title = "暂无内容",
  subtitle,
  actionLabel,
  onAction,
}: {
  title?: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
}) {
  const { colors, accent } = useAppTheme()
  return (
    <View style={styles.center}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>{subtitle}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={[styles.retryBtn, { backgroundColor: accent }]}
        >
          <Text style={styles.retryBtnText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function InlineFooterLoader({
  loading,
  hasMore,
  error,
  onLoadMore,
  endText = "已加载全部内容",
}: {
  loading: boolean
  hasMore: boolean
  error?: string | null
  onLoadMore?: () => void
  endText?: string
}) {
  const { colors, accent } = useAppTheme()
  if (loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={accent} />
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>正在加载更多…</Text>
      </View>
    )
  }
  if (error) {
    return (
      <View style={styles.footer}>
        <Text style={[styles.footerError, { color: colors.danger }]} numberOfLines={2}>
          {error}
        </Text>
        {onLoadMore ? (
          <Pressable onPress={onLoadMore} style={[styles.smallBtn, { borderColor: accent }]}>
            <Text style={[styles.smallBtnText, { color: accent }]}>重试下一页</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }
  if (hasMore && onLoadMore) {
    return (
      <View style={styles.footer}>
        <Pressable onPress={onLoadMore} style={[styles.smallBtn, { borderColor: colors.separator }]}>
          <Text style={[styles.smallBtnText, { color: colors.textSecondary }]}>加载更多</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <View style={styles.footer}>
      <Text style={[styles.footerText, { color: colors.textTertiary }]}>{endText}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  icon: {
    fontSize: 34,
    fontWeight: "800",
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 8,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerText: {
    fontSize: 12,
  },
  footerError: {
    fontSize: 12,
    textAlign: "center",
  },
  smallBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  smallBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
})
