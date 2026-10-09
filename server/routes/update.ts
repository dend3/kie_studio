import { Hono } from 'hono'

export interface UpdateCheckResult {
  available: boolean
  version?: string
  downloaded?: boolean
}

type UpdateHandler = () => Promise<UpdateCheckResult>

// globalThis に保存する。Electrobun のバンドラは server/app.ts 経由と
// src/bun/index.ts 経由でこのモジュールのインスタンスを2つ生成するため、
// module-level let ではハンドラが共有されない。
const UPDATE_HANDLER_KEY = Symbol.for('kie.updateHandler')

type GlobalWithHandler = typeof globalThis & {
  [UPDATE_HANDLER_KEY]?: UpdateHandler
}

/**
 * デスクトップメインプロセス（src/bun/index.ts）から Updater ハンドラを登録する。
 * 未登録時（dev / web 環境）は 503 を返す。
 */
export function registerUpdateHandler(fn: UpdateHandler) {
  ;(globalThis as GlobalWithHandler)[UPDATE_HANDLER_KEY] = fn
}

/** ハンドラ登録済み（= デスクトップ版）かどうか */
export function isUpdateHandlerRegistered(): boolean {
  return typeof (globalThis as GlobalWithHandler)[UPDATE_HANDLER_KEY] === 'function'
}

export const updateRoutes = new Hono()

updateRoutes.post('/update/check', async (c) => {
  const handler = (globalThis as GlobalWithHandler)[UPDATE_HANDLER_KEY]
  if (!handler) {
    return c.json(
      { error: 'Update check is only available in the desktop version' },
      503,
    )
  }
  try {
    const result = await handler()
    return c.json({ data: result })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to check for updates'
    return c.json({ error: message }, 500)
  }
})
