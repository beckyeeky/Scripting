import React from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native"
import { useAppTheme } from "../theme/ThemeProvider"

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const { colors } = useAppTheme()
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionHeaderText, { color: colors.textSecondary }]}>{title}</Text>
      {right}
    </View>
  )
}

export function SectionCard({
  children,
  style,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useAppTheme()
  return (
    <View
      style={[
        styles.sectionCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.glassBorder,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

export function SettingRow({
  title,
  subtitle,
  value,
  icon,
  iconColor,
  onPress,
  showChevron = false,
  destructive = false,
  isLast = false,
  right,
}: {
  title: string
  subtitle?: string
  value?: string
  icon?: string
  iconColor?: string
  onPress?: () => void
  showChevron?: boolean
  destructive?: boolean
  isLast?: boolean
  right?: React.ReactNode
}) {
  const { colors } = useAppTheme()
  const content = (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
      ]}
    >
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: iconColor ? `${iconColor}20` : colors.fill }]}>
          <Text style={[styles.rowIconText, { color: iconColor ?? colors.text }]}>{icon}</Text>
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <Text
          style={[
            styles.rowTitle,
            { color: destructive ? colors.danger : colors.text },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: colors.textSecondary }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {showChevron ? (
        <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
      ) : null}
    </View>
  )

  if (!onPress) return content
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.65 }}
    >
      {content}
    </Pressable>
  )
}

export function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled = false,
  isLast = false,
}: {
  title: string
  subtitle?: string
  value: boolean
  onValueChange: (val: boolean) => void
  disabled?: boolean
  isLast?: boolean
}) {
  const { accent, colors } = useAppTheme()
  return (
    <SettingRow
      title={title}
      subtitle={subtitle}
      isLast={isLast}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: colors.fillStrong, true: accent }}
          thumbColor="#FFFFFF"
        />
      }
    />
  )
}

export function ActionButton({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
}: {
  title: string
  onPress: () => void
  variant?: "primary" | "secondary" | "danger" | "ghost"
  loading?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { accent, colors } = useAppTheme()
  const bg =
    variant === "primary"
      ? accent
      : variant === "danger"
        ? colors.danger
        : variant === "secondary"
          ? colors.surface
          : "transparent"
  const textColor =
    variant === "primary" || variant === "danger"
      ? "#FFFFFF"
      : variant === "secondary"
        ? accent
        : colors.textSecondary

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === "secondary" ? colors.glassBorder : "transparent",
          borderWidth: variant === "secondary" ? StyleSheet.hairlineWidth : 0,
        },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text style={[styles.buttonText, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  style?: StyleProp<ViewStyle>
}) {
  const { colors, accent } = useAppTheme()
  return (
    <View style={[styles.segTrack, { backgroundColor: colors.fill }, style]}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.value)}
            style={[
              styles.segItem,
              active && { backgroundColor: colors.surface, shadowOpacity: 0.08 },
            ]}
          >
            <Text
              style={[
                styles.segLabel,
                { color: active ? accent : colors.textSecondary },
                active && { fontWeight: "700" },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ThemedTextInput(props: TextInputProps) {
  const { colors } = useAppTheme()
  return (
    <TextInput
      placeholderTextColor={colors.textTertiary}
      {...props}
      style={[
        styles.input,
        {
          color: colors.text,
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.glassBorder,
        },
        props.style,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  sectionCard: {
    marginHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    gap: 12,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconText: {
    fontSize: 15,
    fontWeight: "700",
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "500",
  },
  rowSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  rowValue: {
    fontSize: 14,
    maxWidth: 140,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 22,
    fontWeight: "400",
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  segTrack: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segItem: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  input: {
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
})
