import React from "react"
import { StyleSheet, View } from "react-native"
import { ScreenHeader } from "../components/ScreenHeader"
import { EmptyView } from "../components/StateViews"
import { useAppNav } from "../navigation/NavContext"
import { useAppTheme } from "../theme/ThemeProvider"

export function NotFoundScreen({ rawRoute }: { rawRoute: string }) {
  const { colors } = useAppTheme()
  const nav = useAppNav()

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title="页面未找到" showBack={nav.canGoBack} onBack={() => nav.pop()} />
      <EmptyView
        title="无法识别该路由"
        subtitle={rawRoute || "链接格式无效"}
        actionLabel={nav.canGoBack ? "返回上一页" : undefined}
        onAction={nav.canGoBack ? () => nav.pop() : undefined}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
