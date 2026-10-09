import { assertKieOk, KieApiError, kieFetch } from '../client.ts'
import type {
  AlignedWord,
  MediaAsset,
  NormalizedTask,
  Operation,
  TaskState,
} from '../types.ts'
import type { ProviderAdapter } from './types.ts'
import {
  asNumber,
  asRecord,
  asString,
  failOrPartial,
  type KieResponse,
  normalizeEpoch,
  uniqueUrls,
  unknownOrPartial,
  unwrapKiePayload,
} from './utils.ts'

const CREATE_PATHS: Partial<Record<Operation, string>> = {
  generate: '/api/v1/generate',
  extend: '/api/v1/generate/extend',
  'upload-cover': '/api/v1/generate/upload-cover',
  'upload-extend': '/api/v1/generate/upload-extend',
  'replace-section': '/api/v1/generate/replace-section',
  'cover-art': '/api/v1/suno/cover/generate',
  lyrics: '/api/v1/lyrics',
}

function sunoState(value: unknown, mediaCount: number): TaskState {
  switch (value) {
    case 'PENDING':
      return 'waiting'
    case 'TEXT_SUCCESS':
      return 'generating'
    case 'FIRST_SUCCESS':
      return mediaCount > 0 ? 'partial' : 'generating'
    case 'SUCCESS':
      return 'success'
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
    case 'FAILED':
      return failOrPartial(mediaCount)
    default:
      return unknownOrPartial(mediaCount)
  }
}

function mediaFromSunoData(value: unknown): MediaAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): MediaAsset[] => {
    const item = asRecord(entry)
    if (!item) return []
    const url = asString(item.audioUrl)
    const streamUrl = asString(item.streamAudioUrl)
    if (!url && !streamUrl) return []
    const id = asString(item.id) ?? asString(item.audioId)
    const asset: MediaAsset = {
      kind: 'audio',
      id,
      providerAssetId: id,
      url,
      streamUrl,
      previewUrl: asString(item.imageUrl),
      title: asString(item.title),
      duration: asNumber(item.duration),
      metadata: {
        modelName: item.modelName,
        prompt: item.prompt,
        tags: item.tags,
        createTime: item.createTime,
      },
    }
    return [asset]
  })
}

export function normalizeSunoTask(
  taskId: string,
  operation: Operation,
  payload: unknown,
): NormalizedTask {
  const { data, response } = unwrapKiePayload(payload)
  const media = mediaFromSunoData(response.sunoData ?? data.sunoData)
  if (operation === 'lyrics') {
    const lyrics = asString(response.lyrics)
      ?? asString(response.text)
      ?? asString(data.lyrics)
      ?? asString(data.text)
    if (lyrics) {
      media.push({
        kind: 'text',
        title: 'Generated lyrics',
        metadata: { text: lyrics },
      })
    }
  }
  if (operation === 'cover-art') {
    const image = asString(response.resultUrl) ?? asString(response.imageUrl)
    if (image) media.push({ kind: 'image', url: image })
  }
  const providerStatus = asString(data.status)
    ?? asString(data.successFlag)
    ?? asString(response.status)
  const state = sunoState(providerStatus, media.length)
  return {
    taskId: asString(data.taskId) ?? taskId,
    provider: 'suno',
    operation,
    state,
    providerStatus,
    model: asString(data.model) ?? asString(response.modelName),
    media,
    resultUrls: uniqueUrls(media),
    partial: state === 'partial',
    failCode: asString(data.errorCode) ?? asString(data.failCode),
    failMsg: asString(data.errorMessage) ?? asString(data.failMsg),
    createTime: normalizeEpoch(data.createTime),
    updateTime: normalizeEpoch(data.updateTime),
    creditsConsumed: asNumber(data.creditsConsumed),
    rawParam: data.param,
    rawResult: payload,
  }
}

function taskPath(operation: Operation, taskId: string): string {
  const encoded = encodeURIComponent(taskId)
  switch (operation) {
    case 'lyrics':
      return `/api/v1/lyrics/record-info?taskId=${encoded}`
    case 'cover-art':
      return `/api/v1/suno/cover/record-info?taskId=${encoded}`
    case 'generate':
    case 'extend':
    case 'upload-cover':
    case 'upload-extend':
    case 'replace-section':
      return `/api/v1/generate/record-info?taskId=${encoded}`
    case 'upscale-1080p':
    case 'upscale-4k':
    case 'aleph':
      throw new KieApiError(`Unsupported Suno operation: ${operation}`, 400)
    default: {
      const exhaustive: never = operation
      throw new KieApiError(`Unsupported Suno operation: ${exhaustive}`, 400)
    }
  }
}

export const sunoAdapter: ProviderAdapter = {
  provider: 'suno',
  async create(input) {
    const path = CREATE_PATHS[input.operation]
    if (!path) {
      throw new KieApiError(`Unsupported Suno operation: ${input.operation}`, 400)
    }
    const body = { ...input.input } as Record<string, unknown>
    if (input.callBackUrl) body.callBackUrl = input.callBackUrl
    const response = await kieFetch<KieResponse>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    assertKieOk(response.code, response.msg, 'Failed to create Suno task')
    const data = asRecord(response.data)
    const taskId = asString(data?.taskId)
    if (!taskId) throw new KieApiError('Suno did not return a taskId', 502)
    return { taskId }
  },
  async getTask(taskId, operation) {
    const response = await kieFetch<KieResponse>(taskPath(operation, taskId))
    assertKieOk(response.code, response.msg, 'Failed to get Suno task')
    return normalizeSunoTask(taskId, operation, response)
  },
}

export async function getTimestampedLyrics(params: {
  taskId: string
  audioId: string
}): Promise<{ alignedWords: AlignedWord[]; waveformData: number[] }> {
  const response = await kieFetch<KieResponse>(
    '/api/v1/generate/get-timestamped-lyrics',
    { method: 'POST', body: JSON.stringify(params) },
  )
  assertKieOk(response.code, response.msg, 'Failed to get timestamped lyrics')
  const data = asRecord(response.data) ?? {}
  const alignedWords = Array.isArray(data.alignedWords)
    ? data.alignedWords.flatMap((entry): AlignedWord[] => {
        const word = asRecord(entry)
        const text = asString(word?.word)
        const startS = asNumber(word?.startS)
        const endS = asNumber(word?.endS)
        if (!text || startS === undefined || endS === undefined) return []
        return [{
          word: text,
          startS,
          endS,
          success: typeof word?.success === 'boolean' ? word.success : undefined,
          palign: asNumber(word?.palign),
        }]
      })
    : []
  const waveformData = Array.isArray(data.waveformData)
    ? data.waveformData.filter(
        (value): value is number => typeof value === 'number' && Number.isFinite(value),
      )
    : []
  return { alignedWords, waveformData }
}

export async function boostMusicStyle(style: string): Promise<string> {
  const response = await kieFetch<KieResponse>('/api/v1/style/generate', {
    method: 'POST',
    body: JSON.stringify({ style }),
  })
  assertKieOk(response.code, response.msg, 'Failed to improve music style')
  const data = asRecord(response.data) ?? {}
  return asString(data.result) ?? asString(data.style) ?? style
}

export async function generatePersona(params: {
  taskId: string
  audioId: string
  name: string
  description?: string
}): Promise<{ personaId: string; name: string; description?: string }> {
  const response = await kieFetch<KieResponse>('/api/v1/generate/generate-persona', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  assertKieOk(response.code, response.msg, 'Failed to create persona')
  const data = asRecord(response.data) ?? {}
  const personaId = asString(data.personaId)
  if (!personaId) throw new KieApiError('Suno did not return a personaId', 502)
  return {
    personaId,
    name: asString(data.name) ?? params.name,
    description: asString(data.description) ?? params.description,
  }
}
