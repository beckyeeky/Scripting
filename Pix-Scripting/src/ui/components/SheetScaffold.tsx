import {
  NavigationStack,
  VStack,
  ZStack,
  type Color,
  type PresentationDetent,
  type VirtualNode,
} from "scripting"
import { PrivacyShield } from "./PrivacyShield"
import { sheetDetents } from "./pageChrome"

export interface SheetScaffoldProps {
  /**
   * 半模态展开档位，默认走跨端自适应的 sheetDetents()
   */
  detents?: PresentationDetent[]
  /**
   * 拖动手柄指示器，默认 "visible"
   */
  dragIndicator?: "visible" | "hidden"
  /**
   * 主题色调
   */
  tint?: Color
  /**
   * 是否跳过内部 NavigationStack（若为 true 则仅作为带隐私遮罩的容器外壳）
   */
  noNavigationStack?: boolean
  /**
   * 子内容
   */
  children?: VirtualNode
}

/**
 * 全工程统一半模态 Sheet 外壳容器组件
 *
 * 核心特性：
 * 1. 统一收纳 presentationDetents 跨端自适应（iPad 大屏展开 large，iPhone 保持半屏单手操作）；
 * 2. 统一内置多任务隐私保护遮罩 PrivacyShield，彻底解决 Sheet 脱离 Root 视图树导致的多任务预览泄露；
 * 3. 统一规范顶层 NavigationStack 容器与拖动指示器样式。
 */
export function SheetScaffold(props: SheetScaffoldProps) {
  const {
    detents,
    dragIndicator = "visible",
    tint,
    noNavigationStack = false,
    children,
  } = props

  const effectiveDetents = detents ?? sheetDetents()
  const contentNode = children ?? <VStack />

  if (noNavigationStack) {
    return (
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        presentationDetents={effectiveDetents}
        presentationDragIndicator={dragIndicator}
        tint={tint}
      >
        {contentNode}
        <PrivacyShield />
      </ZStack>
    )
  }

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      presentationDetents={effectiveDetents}
      presentationDragIndicator={dragIndicator}
      tint={tint}
    >
      <NavigationStack
        presentationDetents={effectiveDetents}
        presentationDragIndicator={dragIndicator}
        tint={tint}
      >
        {contentNode}
      </NavigationStack>
      <PrivacyShield />
    </ZStack>
  )
}
