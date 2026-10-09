import { Hono } from 'hono'
import { uploadFileStream, uploadFromUrl } from '../kie/upload.ts'
import {
  assertSafeHttpsUrl,
  sanitizeFileName,
  sanitizeUploadPath,
} from '../kie/safe.ts'
import { KieApiError } from '../kie/client.ts'
import { listAudioAssets, removeAudioAsset, saveAudioAsset } from '../db/audio-assets.ts'
import { z } from 'zod'
import { firstIssueMessage } from './validation.ts'

export const uploadRoutes = new Hono()

/** アップロード上限（音源用途を考慮して 100MB） */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

// content-type で JSON / multipart を分岐するため zValidator ミドルウェアではなく
// JSON ブランチ内で safeParse する
const uploadJsonSchema = z.object({
  fileUrl: z.string({ error: 'fileUrl is required' }).min(1, 'fileUrl is required'),
  uploadPath: z.string().optional(),
  fileName: z.string().optional(),
})

function expiryTimestamp(value?: string): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function looksLikeAudio(name: string): boolean {
  return /\.(?:mp3|wav|m4a|aac|ogg|flac|opus)(?:$|\?)/i.test(name)
}

uploadRoutes.get('/audio-assets', (c) =>
  c.json({ data: { items: listAudioAssets() } }),
)

uploadRoutes.delete('/audio-assets/:id', (c) => {
  const removed = removeAudioAsset(c.req.param('id'))
  return removed
    ? c.json({ data: { removed: true } })
    : c.json({ error: 'Audio asset not found' }, 404)
})

uploadRoutes.post('/upload', async (c) => {
  const contentType = c.req.header('content-type') || ''

  if (contentType.includes('application/json')) {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const parsed = uploadJsonSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: firstIssueMessage(parsed.error) }, 400)
    }
    const body = parsed.data
    try {
      assertSafeHttpsUrl(body.fileUrl, 'fileUrl')
      const uploadPath = sanitizeUploadPath(body.uploadPath)
      const fileName = body.fileName
        ? sanitizeFileName(body.fileName, 'upload.bin')
        : undefined
      const result = await uploadFromUrl(body.fileUrl, {
        uploadPath,
        fileName,
      })
      const originalFileName = body.fileName ?? new URL(body.fileUrl).pathname.split('/').pop()
      if (originalFileName && looksLikeAudio(originalFileName)) {
        saveAudioAsset({
          url: result.fileUrl,
          name: originalFileName,
        })
      }
      return c.json({
        data: {
          ...result,
          originalFileName,
        },
      })
    } catch (e) {
      if (e instanceof KieApiError && e.status === 400) {
        return c.json({ error: e.message }, 400)
      }
      throw e
    }
  }

  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return c.json({ error: 'file is required' }, 400)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      { error: `File size exceeds the limit (${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` },
      413,
    )
  }

  try {
    const uploadPath = sanitizeUploadPath(
      String(form.get('uploadPath') || 'kie-studio'),
    )
    const fileName = sanitizeFileName(
      String(form.get('fileName') || file.name),
      file.name || 'upload.bin',
    )
    const result = await uploadFileStream(file, { uploadPath, fileName })
    if (file.type.startsWith('audio/') || looksLikeAudio(file.name)) {
      saveAudioAsset({
        url: result.fileUrl,
        name: file.name,
        expiresAt: expiryTimestamp(result.expiresAt),
      })
    }
    return c.json({ data: { ...result, originalFileName: file.name } })
  } catch (e) {
    if (e instanceof KieApiError && e.status === 400) {
      return c.json({ error: e.message }, 400)
    }
    throw e
  }
})
