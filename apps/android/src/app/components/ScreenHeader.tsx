import React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"

export interface ScreenHeaderProps {
  title: string
  subtitle?: string
  showBack?: boolean
  onBack?: () => void
  left?: React.ReactNode
  right?: React.ReactNode
  transparent?: boolean
  bottom?: React.ReactNode
}

export function ScreenHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  left,
  right,
  transparent = false,
  bottom,
}: ScreenHeaderProps) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()

  return (
    <View
      style={[
        styles.wrapper,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          backgroundColor: transparent ? "transparent" : colors.glassBg,
          borderBottomColor: transparent ? "transparent" : colors.separator,
          borderBottomWidth: transparent ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.sideLeft}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回"
              onPress={onBack}
              hitSlop={10}
              style={styles.backBtn}
            >
              <Text style={[styles.backChevron, { color: accent }]}>‹</Text>
              <Text style={[styles.backText, { color: accent }]}>返回</Text>
            </Pressable>
          ) : (
            left
          )}
        </View>

        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.sideRight}>{right}</View>
      </View>
      {bottom}
    </View>
  )
}

export function HeaderIconButton({
  label,
  onPress,
  active = false,
  disabled = false,
  color,
}: {
  label: string
  onPress: () => void
  active?: boolean
  disabled?: boolean
  color?: string
}) {
  const { accent, accentSoft, colors } = useAppTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={[
        styles.headerBtn,
        active && { backgroundColor: accentSoft },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text
        style={[
          styles.headerBtnText,
          { color: color ?? (active ? accent : colors.text) },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    zIndex: 10,
  },
  row: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  sideLeft: {
    minWidth: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  sideRight: {
    minWidth: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  titleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingRight: 8,
  },
  backChevron: {
    fontSize: 28,
    lineHeight: 28,
    fontWeight: "300",
    marginTop: -2,
    marginRight: 2,
  },
  backText: {
    fontSize: 15,
    fontWeight: "600",
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  headerBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
})
