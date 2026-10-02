import { getEffectiveGeneralEndpoint, type GeneralAIConfig } from "../../store/customAI"

export interface TranslationThinkingControl {
  payload: Record<string, unknown>
  status: "disabled" | "unavailable"
  label: string
}

/** 只为小说翻译请求设置经服务商文档确认的关闭参数，避免兼容网关因未知字段返回 400。 */
export function translationThinkingControl(config: GeneralAIConfig): TranslationThinkingControl {
  let host = ""
  try { host = new URL(getEffectiveGeneralEndpoint(config)).hostname.toLowerCase() } catch {}
  const model = config.model.toLowerCase().split("/").pop() ?? ""
  const chat = config.protocol === "openai-chat"
  const responses = config.protocol === "openai-responses"

  if (host === "api.deepseek.com" && (chat || responses)) {
    return { payload: chat ? { thinking: { type: "disabled" } } : { reasoning: { effort: "none" } },
      status: "disabled", label: "DeepSeek 已请求关闭思考" }
  }
  if (host === "openrouter.ai" && (chat || responses)) {
    return { payload: chat ? { reasoning: { enabled: false } } : { reasoning: { effort: "none" } },
      status: "disabled", label: "OpenRouter 已请求关闭思考；实际支持取决于所选模型" }
  }
  if (host === "api.openai.com" && (chat || responses)
    && /^gpt-5\.(?:[1-9]|\d{2,})(?:[-.]|$)/.test(model) && !/-pro(?:-|$)/.test(model)) {
    return { payload: chat ? { reasoning_effort: "none" } : { reasoning: { effort: "none" } },
      status: "disabled", label: "OpenAI 已请求关闭思考" }
  }
  if (config.protocol === "gemini" && host === "generativelanguage.googleapis.com"
    && /^gemini-2\.5-flash(?:-lite|-preview)?(?:-\d+)?$/.test(model)) {
    return { payload: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } },
      status: "disabled", label: "Gemini 已请求关闭思考" }
  }
  if (config.protocol === "anthropic" && host === "api.anthropic.com") {
    if (/^claude-sonnet-5-5(?:$|-\d{8}$)/.test(model)) {
      return { payload: { thinking: { type: "between_tools" } }, status: "disabled",
        label: "Claude Sonnet 5.5 已请求关闭前置思考；小说翻译不使用工具" }
    }
    if (/^claude-(?:opus|sonnet)-5(?:$|-\d{8}$)/.test(model)) {
      return { payload: { thinking: { type: "disabled" } }, status: "disabled", label: "Claude 已请求关闭思考" }
    }
    if (/^claude-(?:opus-4-[5-8]|sonnet-4-[5-6]|haiku-4-5)(?:$|-\d{8}$)/.test(model)) {
      return { payload: {}, status: "disabled", label: "Claude 使用默认无扩展思考模式" }
    }
  }
  return { payload: {}, status: "unavailable", label: "此模型无法确认关闭思考；译文仍会过滤思考内容" }
}
