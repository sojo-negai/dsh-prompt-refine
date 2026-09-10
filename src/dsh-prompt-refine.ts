// dsh-prompt-refine.ts —— host 半入口
//
// 注册 HTTP 端点 → 让 client 半的弹窗能调过来 → 我们用 ctx.llm.stream()
// 调用当前配置好的模型,返回 3 条优化建议。

import type { Context } from '@deepseek-ai/cordis'
import { registerHttpRoutes } from './host'

export const name = 'dsh-prompt-refine'

// 需要 webServer 注册 HTTP 端点
// 需要 llm 服务在 handler 被调用时已经存在(用 lazy inject,声明在 apply 里)
export const inject = ['webServer']

export function apply(ctx: Context): void {
  // 注册 HTTP 路由(注册时不需要 llm,handler 里才需要)
  registerHttpRoutes(ctx)

  // lazy inject llm:确保 llm 服务存在 + 监听它 ready
  // 这样即使 webServer 先就绪、llm 后就绪也能工作
  ctx.inject(['llm'], (llmCtx) => {
    console.log('[dsh-prompt-refine] llm 服务已就绪,可以处理优化请求')
  })
}