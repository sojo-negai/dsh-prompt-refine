// shared/types.ts —— client 和 host 共享的数据形状

/** 历史中的一条消息 */
export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 客户端 → 服务端的请求 */
export interface SuggestRequest {
  /** 用户当前输入框里的草稿 */
  draft: string
  /** 最近 N 条历史(已截断) */
  history: readonly HistoryMessage[]
  /** 可选:模型 provider。缺省时由 host 读用户配置自动解析 */
  provider?: string
  /** 可选:模型 id。缺省时由 host 读用户配置自动解析 */
  model?: string
}

/** 一条优化建议(对应 UI 里的 tag + issue + patch) */
export interface Suggestion {
  /** 问题类型(scope / format / constraint / clarity / other) */
  tag: string
  /** 一句话说明问题 */
  issue: string
  /** 一句话补丁,追加到原草稿后面 */
  patch: string
}

/** 服务端 → 客户端的响应 */
export interface SuggestResponse {
  ok: boolean
  suggestions?: Suggestion[]
  error?: string
  /** 实际使用的模型(便于前端展示/排查) */
  usedModel?: string
}