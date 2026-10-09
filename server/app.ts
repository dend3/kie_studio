import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { uploadRoutes } from './routes/upload.ts'
import { generateRoutes } from './routes/generate.ts'
import { taskRoutes } from './routes/task.ts'
import { creditsRoutes } from './routes/credits.ts'
import { downloadUrlRoutes } from './routes/download-url.ts'
import { modelsRoutes } from './routes/models.ts'
import { optimizePromptRoutes } from './routes/optimize-prompt.ts'
import { historyRoutes } from './routes/history.ts'
import { sunoRoutes } from './routes/suno.ts'
import { archiveRoutes } from './routes/archive.ts'
import { settingsRoutes } from './routes/settings.ts'
import { llmSettingsRoutes } from './routes/llmSettings.ts'
import { agentConversationsRoutes } from './routes/agentConversations.ts'
import { agentChatRoutes } from './routes/agentChat.ts'
import { agentInternalRoutes } from './routes/agentInternal.ts'
import { updateRoutes, isUpdateHandlerRegistered } from './routes/update.ts'
import { mediaRoutes } from './routes/media.ts'
import { backfillRoutes } from './media/backfill.ts'
import { KieApiError } from './kie/client.ts'
import { hasUsableApiKey } from './settings/apiKey.ts'
import { readCatalog } from './catalog/sync.ts'

function readAppVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const raw = readFileSync(join(root, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version?.trim() || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const APP_VERSION = readAppVersion()

/**
 * Builds the Hono application shared by the dev Bun server (`server/index.ts`)
 * and the packaged Electrobun main process (`src/bun/index.ts`).
 */
export function createApp(): Hono {
  const app = new Hono()

  // Local-only by default: allow Vite dev origins and packaged webview origins
  // (`views://...` or a null origin). Reject all other web origins to
  // prevent malicious sites from accessing the local API.
  // LAN access: set STUDIO_CORS_ORIGINS to a comma-separated list of extra
  // allowed origins (e.g. "http://10.10.1.18:5173,http://kiestudio.lan:5173").
  const DEV_ORIGINS = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(process.env.STUDIO_CORS_ORIGINS
      ? process.env.STUDIO_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : []),
  ])
  app.use(
    '*',
    cors({
      origin: (origin) => {
        // Packaged webview sends null or views:// origin
        if (!origin || origin === 'null' || origin.startsWith('views://')) {
          return origin ?? '*'
        }
        return DEV_ORIGINS.has(origin) ? origin : ''
      },
      exposeHeaders: [
        'X-Vercel-AI-UI-Message-Stream',
        'X-Vercel-AI-Data-Stream',
      ],
    }),
  )

  app.get('/api/health', async (c) => {
    const catalog = await readCatalog()
    return c.json({
      ok: true,
      hasKey: hasUsableApiKey(),
      isDesktop: isUpdateHandlerRegistered(),
      version: APP_VERSION,
      catalogSyncedAt: catalog?.syncedAt ?? null,
    })
  })

  app.route('/api', uploadRoutes)
  app.route('/api', generateRoutes)
  app.route('/api', taskRoutes)
  app.route('/api', creditsRoutes)
  app.route('/api', downloadUrlRoutes)
  app.route('/api', modelsRoutes)
  app.route('/api', optimizePromptRoutes)
  app.route('/api', historyRoutes)
  app.route('/api', sunoRoutes)
  app.route('/api', archiveRoutes)
  app.route('/api', settingsRoutes)
  app.route('/api', llmSettingsRoutes)
  app.route('/api', agentConversationsRoutes)
  app.route('/api', agentChatRoutes)
  app.route('/api', agentInternalRoutes)
  app.route('/api', updateRoutes)
  app.route('/api', backfillRoutes)
  app.route('/', mediaRoutes)

  app.onError((err, c) => {
    // zValidator（JSON パース失敗など）は HTTPException を投げるため
    // 既存の `{ error: string }` 形式へ変換して返す
    if (err instanceof HTTPException) {
      return c.json({ error: err.message || 'Bad Request' }, err.status)
    }
    if (err instanceof KieApiError) {
      console.error('[kie]', err.message, { status: err.status, code: err.code })
      const status =
        err.status >= 400 && err.status < 600
          ? (err.status as 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503)
          : 500
      return c.json({ error: err.message, code: err.code }, status)
    }
    console.error(err)
    return c.json({ error: err.message || 'Internal Server Error' }, 500)
  })

  return app
}
