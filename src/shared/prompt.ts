// shared/prompt.ts —— 优化器 system prompt + JSON 提取
//
// MVP 阶段:用同一段提示词让 LLM 返回 3 条建议。系统提示明确要求
// 输出 JSON 格式。LLM 不总是严格遵守 → 我们做多策略解析兜底。

/** 优化器 system prompt —— 关键是要 LLM 返回可被 JSON.parse 的结构 */
export const SYSTEM_PROMPT = `你是一个提示词优化助手。用户给你:
1. 一段最近的对话历史(可能为空)
2. 用户即将发送的最新草稿

你的任务:分析草稿的不足,给出恰好 3 条改进建议。每条建议 = 一个「问题标签」+「问题描述」+「具体补丁」。

要求:
- 只输出合法 JSON,不要任何额外文字、不要 markdown 代码块标记
- patch 必须是可以直接追加到原草稿末尾或合适位置的一句话,长度 5-50 字
- 优先指出:范围不清、缺少输出格式、缺少约束条件、模糊指代
- 不要重写整个草稿,只补漏
- 如果草稿已经足够好,issue 里如实写「无需修改」,patch 留空

输出 schema(严格遵守):
{"suggestions": [{"tag": "scope|format|constraint|clarity|other", "issue": "一句话问题", "patch": "一句话补丁"}, ...共 3 条]}
` as const

/** 用户消息模板:把 history + draft 装进 user message */
export function buildUserMessage(history: readonly { role: string; content: string }[], draft: string): string {
  const lines: string[] = []
  if (history.length > 0) {
    lines.push('【最近对话历史】')
    for (const m of history) {
      lines.push(`${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    }
    lines.push('')
  }
  lines.push('【用户当前草稿】')
  lines.push(draft)
  lines.push('')
  lines.push('请按 system 要求输出 JSON。')
  return lines.join('\n')
}

/**
 * 从 LLM 输出里提取 JSON。
 * 策略:
 *   1. 去掉可能的 markdown ```json``` 包裹
 *   2. 找到第一个 { 到最后一个 } 的子串,parse
 *   3. parse 失败抛错(调用方会回退)
 */
export function parseSuggestions(raw: string): { tag: string; issue: string; patch: string }[] {
  // 去 markdown fence
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  // 找 JSON 边界
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first < 0 || last <= first) {
    throw new Error('LLM 输出不含 JSON 对象')
  }
  const json = s.slice(first, last + 1)
  const obj = JSON.parse(json) as { suggestions?: unknown }
  const arr = obj.suggestions
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('JSON 里没有 suggestions 数组')
  }
  // 规范化每条
  return arr.slice(0, 3).map((raw, i) => {
    const x = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    return {
      tag: typeof x.tag === 'string' ? x.tag : 'other',
      issue: typeof x.issue === 'string' ? x.issue : `建议 #${i + 1}`,
      patch: typeof x.patch === 'string' ? x.patch : '',
    }
  })
}