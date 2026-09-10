// host.ts —— 暴露 HTTP 端点,client 调过来我们再调 ctx.llm.stream()
//
// 端点:
//   POST /dsh-prompt-refine/suggest
//     body: SuggestRequest (JSON)
//     resp: SuggestResponse (JSON)
//
// 关键点:
//   - LLM 调用用官方 ctx.llm.stream();消息必须用 createUserMessage 等
//     工厂函数构造(Message.content 是 ContentBlock[] 不是 string)
//   - 模型缺省时读用户 settings.yaml 的 agent-default-model(开箱即用)
//   - 失败时降级到兜底建议,前端永远有东西可显示

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SuggestRequest, SuggestResponse, Suggestion } from './shared/types'
import { SYSTEM_PROMPT, buildUserMessage, parseSuggestions } from './shared/prompt'

export const ROUTE_PREFIX = '/dsh-prompt-refine'

/** ctx.llm 的最小可用子集 */
interface LlmLike {
  stream(options: {
    provider: string
    model: string
    system?: string
    messages: Message[]
  }): AsyncIterable<StreamChunk>
}

/** 读请求体 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 写 JSON 响应 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 拿到 llm 服务(懒注入:即使它晚于 webServer 就绪也能等到) */
function resolveLlm(ctx: Context): Promise<LlmLike> {
  return new Promise<LlmLike>((resolve, reject) => {
    try {
      ctx.inject(['llm'], (llmCtx) => {
        const llm = (llmCtx as unknown as { llm?: LlmLike }).llm
        if (!llm) {
          reject(new Error('ctx.llm 不存在'))
          return
        }
        resolve(llm)
      })
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * 读用户 settings.yaml 里的 agent-default-model,拿到默认 provider/model。
 * 用逐行扫描而不是 YAML 库:结构固定,避免引入依赖。
 */
async function resolveDefaultModel(): Promise<{ provider: string; model: string }> {
  const fallback = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  try {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const text = await readFile(join(home, 'settings.yaml'), 'utf8')
    const lines = text.split(/\r?\n/)
    // 找到 agent-default-model: 之后的缩进块
    let i = lines.findIndex(l => /^agent-default-model\s*:/.test(l))
    if (i < 0) return fallback
    let provider = ''
    let model = ''
    for (i += 1; i < lines.length; i++) {
      const line = lines[i]
      // 遇到下一个顶层 key(非缩进、非空)就结束
      if (/^\S/.test(line)) break
      const pm = line.match(/^\s+provider\s*:\s*(\S+)/)
      const mm = line.match(/^\s+model\s*:\s*(\S+)/)
      if (pm) provider = pm[1]
      if (mm) model = mm[1]
    }
    if (provider && model) return { provider, model }
    return fallback
  } catch {
    return fallback
  }
}

/**
 * 调一次 LLM,拼出完整文本。
 * Message 用官方工厂函数构造。
 */
async function callLlm(
  ctx: Context,
  req: { draft: string; history: readonly { role: 'user' | 'assistant'; content: string }[]; provider: string; model: string },
): Promise<string> {
  const llm = await resolveLlm(ctx)

  // 历史消息 → 官方 Message 对象
  const historyMessages: Message[] = req.history.map(m => m.role === 'user'
    ? createUserMessage({
      content: [{ type: 'text', text: m.content }],
      source: { kind: 'user' },
    })
    : createAssistantMessage({
      content: [{ type: 'text', text: m.content }],
      source: { provider: req.provider, model: req.model },
    }))

  // 当前草稿作为最后一条 user 消息
  const draftMessage = createUserMessage({
    content: [{ type: 'text', text: buildUserMessage([], req.draft) }],
    source: { kind: 'user' },
  })

  const stream = llm.stream({
    provider: req.provider,
    model: req.model,
    system: SYSTEM_PROMPT,
    messages: [...historyMessages, draftMessage],
  })

  let out = ''
  let lastError = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      out += chunk.text
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason as { kind?: string; failure?: { message?: string } } | undefined
      if (reason?.kind === 'error') lastError = reason.failure?.message ?? '未知模型错误'
    }
  }
  if (!out && lastError) throw new Error(`模型调用失败: ${lastError}`)
  return out
}

/** 兜底建议 —— LLM 挂掉或解析失败时给用户一个能用的结果 */
function fallbackSuggestions(): Suggestion[] {
  return [
    { tag: 'clarity', issue: '请补充更多背景信息(语言、目标、约束)', patch: '请补充:编程语言 / 目标读者 / 期望长度' },
    { tag: 'format', issue: '请指定输出格式(代码 / 表格 / 列表 / 段落)', patch: '请用 Markdown 格式返回' },
    { tag: 'constraint', issue: '请说明边界条件或偏好', patch: '请不要使用外部依赖' },
  ]
}

/** 注册 HTTP 路由 */
export function registerHttpRoutes(ctx: Context): void {
  const webServer = (ctx as unknown as {
    webServer?: {
      register(route: {
        kind: string
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
      }): () => void
    }
  }).webServer
  if (!webServer) {
    console.log('[dsh-prompt-refine] webServer 服务不可用,HTTP 端点未注册')
    return
  }

  webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = (req.url ?? '/').split('?')[0]
      const method = req.method ?? 'GET'
      const suggestPath = ROUTE_PREFIX + '/suggest'

      if (url !== suggestPath || method !== 'POST') {
        sendJson(res, 404, { ok: false, error: `not found: ${method} ${url}` })
        return
      }

      try {
        const body = await readBody(req)
        const parsed = JSON.parse(body) as Partial<SuggestRequest>
        const draft = typeof parsed.draft === 'string' ? parsed.draft.trim() : ''
        const history = Array.isArray(parsed.history)
          ? parsed.history.filter((m): m is { role: 'user' | 'assistant'; content: string } =>
            !!m && typeof (m as { content?: unknown }).content === 'string'
            && ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant'),
          )
          : []

        if (!draft) {
          sendJson(res, 400, { ok: false, error: 'draft 不能为空' } satisfies SuggestResponse)
          return
        }

        // 模型:显式传入优先,否则读用户配置
        const explicit = typeof parsed.provider === 'string' && typeof parsed.model === 'string'
          && parsed.provider && parsed.model
        const resolved = explicit
          ? { provider: parsed.provider as string, model: parsed.model as string }
          : await resolveDefaultModel()

        console.log(`[dsh-prompt-refine] 建议请求: draft=${draft.length}字, history=${history.length}条, model=${resolved.provider}/${resolved.model}`)

        try {
          const rawOutput = await callLlm(ctx, { draft, history, ...resolved })
          const suggestions = parseSuggestions(rawOutput)
          sendJson(res, 200, {
            ok: true,
            suggestions,
            usedModel: `${resolved.provider}/${resolved.model}`,
          } satisfies SuggestResponse)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.log(`[dsh-prompt-refine] LLM 调用或解析失败: ${msg}`)
          sendJson(res, 200, {
            ok: true,
            suggestions: fallbackSuggestions(),
            error: '模型调用失败,已用兜底建议: ' + msg,
            usedModel: `${resolved.provider}/${resolved.model}`,
          } satisfies SuggestResponse)
        }
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: '服务器错误: ' + (err instanceof Error ? err.message : String(err)),
        } satisfies SuggestResponse)
      }
    },
  })
  console.log('[dsh-prompt-refine] HTTP 端点已注册: POST ' + ROUTE_PREFIX + '/suggest')
}