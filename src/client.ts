// client.ts —— 浏览器侧 client 半入口
//
// 只有一个注册点:`conversation.input.right`(list slot,发送按钮左侧)。
// 该组件自己负责:✨ 按钮 + 弹窗(用 React Portal 挂到 document.body)。
//
// ⚠️ 关键教训:不要注册 `conversation` 这类 single slot —— 会被
// ui-conversation 占用,重复注册会让整个 client 插件加载失败
// ("single slot already has a registration")。
//
// 交互:
//   点 ✨ → 读草稿 + 最近历史 → POST /dsh-prompt-refine/suggest
//        → 弹窗列 3 条建议(可勾选)→ 采纳 → inputActions.setDraft(新草稿)
//        → 关弹窗,用户自己按发送键(不抢发送权)

declare global {
  interface Window {
    __ModuleLoader__: {
      load(info: {
        id: string
        factory: (
          require: (mod: string) => unknown,
        ) => {
          name: string
          inject: string[]
          apply: (ctx: unknown) => void
        }
      }): void
    }
  }
}

function makeFactory(): (require: (mod: string) => unknown) => unknown {
  return (require) => {
    const React = require('react') as {
      createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown
      useState: <T>(init: T | (() => T)) => [T, (v: T | ((p: T) => T)) => void]
      useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void
      Fragment: unknown
    }
    const h = React.createElement
    // ⚠️ createPortal 在 react-dom(不是 react-dom/client —— 那里只有 createRoot)
    const { createPortal } = require('react-dom') as {
      createPortal: (node: unknown, container: Element) => unknown
    }

    const name = 'dsh-prompt-refine'
    const inject: string[] = ['slots']

    // ===== Portal 宿主(模块级,只创建一次)=====
    let portalHost: HTMLElement | null = null
    function getPortalHost(): HTMLElement {
      if (portalHost === null || !portalHost.isConnected) {
        portalHost = document.createElement('div')
        portalHost.id = 'dsh-prompt-refine-portal'
        document.body.appendChild(portalHost)
      }
      return portalHost
    }

    // ===== 样式(全部用 DSH 语义 token,暗色自动适配)=====
    const S = {
      btn: {
        padding: 0, width: '32px', height: '32px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '15px', lineHeight: 1,
      },
      overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: '20px',
      },
      modal: {
        background: 'var(--dsw-alias-bg-layer-1)', borderRadius: '14px',
        width: '100%', maxWidth: '560px', maxHeight: '86vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)',
      },
      header: { padding: '18px 22px 14px', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
      title: { fontSize: '16px', fontWeight: 600, margin: '0 0 4px' },
      subtitle: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      original: {
        margin: '14px 22px 0', padding: '10px 12px',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04))', borderRadius: '8px',
        fontSize: '13px', color: 'var(--dsw-alias-label-secondary)',
        borderLeft: '3px solid var(--dsw-alias-label-tertiary)',
      },
      originalLabel: {
        fontSize: '10px', color: 'var(--dsw-alias-label-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px',
      },
      list: { padding: '14px 22px' },
      row: {
        display: 'flex', gap: '12px', padding: '12px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px',
        marginBottom: '8px', cursor: 'pointer',
      },
      rowOn: {
        borderColor: 'var(--dsw-alias-state-business-primary)',
        background: 'var(--dsw-alias-interactive-bg-active, rgba(37,99,235,0.08))',
      },
      rowBody: { flex: 1, minWidth: 0 },
      tag: {
        display: 'inline-block', fontSize: '11px', padding: '2px 7px',
        borderRadius: '4px', fontWeight: 500, marginBottom: '6px',
      },
      tagScope: { background: 'var(--dsw-alias-state-error-secondary)', color: 'var(--dsw-alias-state-error-primary)' },
      tagFormat: { background: 'rgba(217,119,6,0.14)', color: '#d97706' },
      tagConstraint: { background: 'rgba(37,99,235,0.14)', color: 'var(--dsw-alias-state-business-primary)' },
      tagClarity: { background: 'rgba(5,150,105,0.16)', color: 'var(--dsw-alias-state-success-primary)' },
      tagOther: { background: 'rgba(128,128,128,0.16)', color: 'var(--dsw-alias-label-secondary)' },
      issue: { fontSize: '13.5px', margin: '0 0 8px', lineHeight: 1.45 },
      patch: {
        fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)',
        background: 'rgba(128,128,128,0.08)', padding: '7px 10px', borderRadius: '6px', margin: 0,
        fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
        border: '1px dashed var(--dsw-alias-border-l2)',
      },
      preview: {
        margin: '0 22px 14px', padding: '10px 12px',
        background: 'rgba(128,128,128,0.08)', borderRadius: '8px', fontSize: '13px',
      },
      previewLabel: {
        fontSize: '10px', color: 'var(--dsw-alias-label-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px',
        display: 'flex', justifyContent: 'space-between',
      },
      previewCount: { color: 'var(--dsw-alias-state-business-primary)', fontWeight: 600 },
      previewText: { lineHeight: 1.6 },
      added: {
        background: 'rgba(5,150,105,0.16)', color: 'var(--dsw-alias-state-success-primary)',
        padding: '1px 5px', borderRadius: '3px', margin: '0 2px', fontWeight: 500,
      },
      footer: {
        padding: '14px 22px', borderTop: '1px solid var(--dsw-alias-border-l2)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
      },
      hint: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      btnSec: {
        padding: '8px 14px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: '14px',
      },
      btnPri: {
        padding: '8px 14px', borderRadius: '8px', border: 'none',
        background: 'var(--dsw-alias-state-business-primary)',
        color: 'var(--dsw-alias-button-info-fill, #fff)', cursor: 'pointer',
        fontSize: '14px', fontWeight: 600,
      },
      skel: {
        height: '58px', background: 'rgba(128,128,128,0.14)',
        borderRadius: '10px', marginBottom: '8px',
      },
      tip: { textAlign: 'center', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', padding: '8px 0' },
      err: { padding: '16px 22px', fontSize: '13px', color: 'var(--dsw-alias-state-error-primary)' },
      warn: { padding: '0 22px 10px', fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary, #d97706)' },
    } as const

    function tagStyle(tag: string): Record<string, string> {
      switch (tag) {
        case 'scope': return S.tagScope as unknown as Record<string, string>
        case 'format': return S.tagFormat as unknown as Record<string, string>
        case 'constraint': return S.tagConstraint as unknown as Record<string, string>
        case 'clarity': return S.tagClarity as unknown as Record<string, string>
        default: return S.tagOther as unknown as Record<string, string>
      }
    }

    interface Item { tag: string; issue: string; patch: string }

    // ===== 主组件:按钮 + 弹窗 =====
    function PromptRefineControl(props: Record<string, unknown>): unknown {
      const useInput = props.useInput as ((sel: (s: { draft: string }) => unknown) => unknown) | undefined
      const useChat = props.useChat as ((sel: (s: { legacy: { nodes: unknown[] } }) => unknown) => unknown) | undefined
      const inputActions = props.inputActions as { setDraft?: (s: string) => void } | undefined

      // hooks 必须无条件调用(顺序稳定)
      const draftNow = ((useInput ? useInput(s => s.draft) : '') as string) ?? ''
      const nodes = ((useChat ? useChat(s => s.legacy.nodes) : []) as unknown[]) ?? []

      const [host] = React.useState<HTMLElement>(() => getPortalHost())
      const [open, setOpen] = React.useState(false)
      const [phase, setPhase] = React.useState<'loading' | 'result' | 'error' | 'empty'>('loading')
      const [reqDraft, setReqDraft] = React.useState('')
      const [items, setItems] = React.useState<Item[]>([])
      const [checked, setChecked] = React.useState<boolean[]>([])
      const [errMsg, setErrMsg] = React.useState('')
      const [usedModel, setUsedModel] = React.useState('')

      // 从最近消息里提取历史(user: content[].type='text';assistant: blocks[].kind='text')
      const collectHistory = (): Array<{ role: 'user' | 'assistant'; content: string }> => {
        const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
        for (let i = nodes.length - 1; i >= 0 && out.length < 6; i--) {
          const n = nodes[i] as {
            kind?: string
            content?: Array<{ type?: string; text?: string }>
            blocks?: Array<{ kind?: string; text?: string }>
          } | undefined
          if (!n) continue
          if (n.kind === 'user') {
            const text = (n.content ?? []).filter(b => b && b.type === 'text').map(b => b.text ?? '').join('').trim()
            if (text) out.unshift({ role: 'user', content: text.slice(0, 500) })
          } else if (n.kind === 'assistant') {
            const text = (n.blocks ?? []).filter(b => b && b.kind === 'text').map(b => b.text ?? '').join('').trim()
            if (text) out.unshift({ role: 'assistant', content: text.slice(0, 500) })
          }
        }
        return out
      }

      const request = (): void => {
        const d = draftNow.trim()
        if (!d) {
          setReqDraft(''); setPhase('empty'); setOpen(true)
          return
        }
        setReqDraft(d); setItems([]); setChecked([]); setErrMsg(''); setUsedModel('')
        setPhase('loading'); setOpen(true)

        const history = collectHistory()
        fetch('/dsh-prompt-refine/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft: d, history }),
        })
          .then(r => r.json())
          .then((data: { ok?: boolean; suggestions?: Item[]; error?: string; usedModel?: string }) => {
            const list = Array.isArray(data?.suggestions) ? data.suggestions.slice(0, 3) : []
            if (data?.ok && list.length > 0) {
              setItems(list)
              // 默认勾选前两条(第 3 条留给用户判断)
              setChecked(list.map((_, i) => i < 2))
              setUsedModel(data.usedModel ?? '')
              setErrMsg(data.error ?? '')
              setPhase('result')
            } else {
              setErrMsg(data?.error ?? '未知错误')
              setPhase('error')
            }
          })
          .catch((e: unknown) => {
            setErrMsg('网络错误: ' + (e instanceof Error ? e.message : String(e)))
            setPhase('error')
          })
      }

      // Esc 关闭
      React.useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [open])

      const close = (): void => setOpen(false)
      const apply = (): void => {
        const patches: string[] = []
        for (let i = 0; i < items.length; i++) {
          if (checked[i] && items[i]?.patch) patches.push(items[i].patch)
        }
        const next = reqDraft + patches.join('')
        if (inputActions?.setDraft) inputActions.setDraft(next)
        setOpen(false)
      }

      const button = h('button', {
        type: 'button',
        title: '优化提示词',
        'aria-label': '优化提示词',
        style: S.btn as unknown as Record<string, string>,
        onClick: (e: { stopPropagation: () => void; preventDefault: () => void }) => {
          e.stopPropagation(); e.preventDefault(); request()
        },
        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
      }, '✨')

      if (!open || !host) return button

      // ---- 弹窗内容 ----
      const selected: string[] = []
      for (let i = 0; i < items.length; i++) if (checked[i] && items[i]?.patch) selected.push(items[i].patch)
      const selectedCount = checked.filter(Boolean).length

      let body: unknown
      if (phase === 'empty') {
        body = h('div', { style: S.err, children: '请先在输入框写点内容,再点 ✨ 优化。' })
      } else if (phase === 'loading') {
        body = h('div', { style: { padding: '18px 22px' }, children: [
          h('div', { style: S.skel }), h('div', { style: S.skel }), h('div', { style: S.skel }),
          h('div', { style: S.tip, children: '正在结合上下文分析…' }),
        ] })
      } else if (phase === 'error') {
        body = h('div', { style: S.err, children: '⚠ ' + (errMsg || '出错了') })
      } else {
        // 建议行(抽成变量,避免深层嵌套写错括号)
        const rows = items.map((s, i) => h('label', {
          key: i,
          style: { ...(S.row as object), ...(checked[i] ? (S.rowOn as object) : {}) } as Record<string, string>,
          children: [
            h('input', {
              type: 'checkbox', checked: !!checked[i],
              onChange: (e: { target: { checked: boolean } }) => {
                setChecked(prev => { const n = [...prev]; n[i] = e.target.checked; return n })
              },
              style: { marginTop: '2px', width: '16px', height: '16px', accentColor: 'var(--dsw-alias-state-business-primary)', cursor: 'pointer' },
            }),
            h('div', { style: S.rowBody, children: [
              h('span', { style: tagStyle(s.tag) as unknown as Record<string, string>, children: s.tag }),
              h('p', { style: S.issue, children: s.issue }),
              s.patch ? h('p', { style: S.patch, children: s.patch }) : null,
            ] }),
          ],
        }))

        // 预览行(原草稿 + 绿色高亮的补丁)
        const previewChildren: unknown[] = [h('span', { key: 'draft', children: reqDraft })]
        selected.forEach((p, i) => {
          previewChildren.push(h('span', { key: 'p' + i, style: S.added as unknown as Record<string, string>, children: p }))
        })

        body = h(React.Fragment, null, [
          h('div', { style: S.original, children: [
            h('div', { style: S.originalLabel, children: '原文' }),
            h('div', { children: reqDraft }),
          ] }),
          h('div', { style: S.list, children: rows }),
          h('div', { style: S.preview, children: [
            h('div', { style: S.previewLabel, children: [
              h('span', { children: '采纳后预览' }),
              h('span', { style: S.previewCount, children: `已选 ${selectedCount} / ${items.length}` }),
            ] }),
            h('div', { style: S.previewText, children: previewChildren }),
          ] }),
          errMsg ? h('div', { style: S.warn, children: '提示:' + errMsg }) : null,
          h('div', { style: S.footer, children: [
            h('span', { style: S.hint, children: (usedModel ? usedModel + ' · ' : '') + 'Esc 关闭' }),
            h('div', { style: { display: 'flex', gap: '8px' }, children: [
              h('button', { type: 'button', style: S.btnSec as unknown as Record<string, string>, onClick: close, children: '跳过' }),
              h('button', { type: 'button', style: S.btnPri as unknown as Record<string, string>, onClick: apply,
                children: selectedCount > 0 ? `采纳 ${selectedCount} 条并填入` : '填入原文' }),
            ] }),
          ] }),
        ])
      }

      const overlay = h('div', {
        style: S.overlay as unknown as Record<string, string>,
        onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) close() },
        children: h('div', {
          style: S.modal as unknown as Record<string, string>,
          onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
          children: [
            h('div', { style: S.header, children: [
              h('div', { style: S.title, children: '✨ 提示词优化建议' }),
              h('p', { style: S.subtitle, children: phase === 'result' ? `发现 ${items.length} 处可以更精确` : '正在结合上下文生成建议' }),
            ] }),
            body,
          ],
        }),
      })

      return h(React.Fragment, null, [button, createPortal(overlay, host)])
    }

    function apply(ctx: unknown): void {
      const c = ctx as {
        slots: {
          inject(slot: string, gen: () => unknown): void
          register(opts: Record<string, unknown>, component: unknown): unknown
        }
      }
      // 唯一注册点:发送按钮左侧的 list slot
      c.slots.inject('conversation.input.right', () => c.slots.register(
        { name: 'conversation.input.right', id: 'dsh-prompt-refine-button', order: 10 },
        PromptRefineControl,
      ))
    }

    return { name, inject, apply }
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-prompt-refine',
  factory: makeFactory(),
})