import React from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import { useAppTheme } from "../theme/ThemeProvider"

export interface ChipItem<T extends string = string> {
  value: T
  label: string
  badge?: string | number
}

export function ChipBar<T extends string>({
  items,
  selected,
  onSelect,
  compact = false,
  trailing,
}: {
  items: ReadonlyArray<ChipItem<T>>
  selected: T | null
  onSelect: (value: T) => void
  compact?: boolean
  trailing?: React.ReactNode
}) {
  const { colors, accent } = useAppTheme()

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal={true}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((item) => {
          const isActive = selected === item.value
          return (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => {
                try {
                  triggerHaptic("selection")
                } catch {}
                onSelect(item.value)
              }}
              style={[
                styles.chip,
                compact && styles.chipCompact,
                {
                  backgroundColor: isActive ? accent : colors.fill,
                  borderColor: isActive ? accent : colors.glassBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  compact && styles.chipTextCompact,
                  { color: isActive ? "#FFFFFF" : colors.text },
                ]}
                numberOfLines={1}
              >
                {item.label}
                {item.badge !== undefined && item.badge !== "" ? ` ${item.badge}` : ""}
              </Text>
            </Pressable>
          )
        })}
        {trailing}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipCompact: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextCompact: {
    fontSize: 12,
  },
})
