import type { FieldSchema, ModelDefinition } from './models/types.ts'

const FIELD_LABELS: Record<string, string> = {
  prompt: 'Prompt',
  negative_prompt: 'Negative prompt',
  negativeprompt: 'Negative prompt',
  image_url: 'Input image',
  image_urls: 'Reference images',
  input_url: 'Input asset',
  input_urls: 'Reference assets',
  reference_image_url: 'Reference image',
  reference_image_urls: 'Reference images',
  video_url: 'Input video',
  video_urls: 'Input videos',
  audio_url: 'Input audio',
  audio_urls: 'Input audio',
  aspect_ratio: 'Aspect ratio',
  aspectratio: 'Aspect ratio',
  resolution: 'Resolution',
  duration: 'Duration',
  duration_seconds: 'Duration',
  quality: 'Quality',
  seed: 'Seed',
  steps: 'Steps',
  guidance_scale: 'Guidance',
}

const CORE_FIELD_NAMES = new Set([
  'prompt',
  'text',
  'custommode',
  'instrumental',
  'aspect_ratio',
  'aspectratio',
  'resolution',
  'duration',
  'duration_seconds',
  'quality',
])

function normalizedName(name: string): string {
  return name.trim().replace(/[-\s]+/g, '_').toLowerCase()
}

function isNsfwChecker(field: FieldSchema): boolean {
  return field.label === 'Nsfw Checker' || normalizedName(field.name) === 'nsfw_checker'
}

export function presentField(field: FieldSchema): FieldSchema {
  if (isNsfwChecker(field)) return field
  const name = normalizedName(field.name)
  if (field.type === 'reference' && (name === 'input_url' || name === 'input_urls')) {
    const accept = field.accept ?? ''
    const label = /audio/i.test(accept)
      ? 'Input audio'
      : /video/i.test(accept) && /image/i.test(accept)
        ? 'Reference assets'
        : /video/i.test(accept)
          ? 'Input video'
          : 'Reference images'
    return { ...field, label }
  }
  const label = FIELD_LABELS[name]
  return label ? { ...field, label } : field
}

export function conciseFieldDescription(field: FieldSchema): string | null {
  if (isNsfwChecker(field)) return field.description ?? null
  const name = normalizedName(field.name)
  if (name === 'prompt') return 'Describe what you want to create'
  if (name === 'negative_prompt' || name === 'negativeprompt') {
    return 'Enter elements to exclude'
  }
  return null
}

export function fieldConstraintHint(field: FieldSchema): string | null {
  const parts: string[] = []
  if (typeof field.maxLength === 'number') {
    parts.push(`Max ${field.maxLength.toLocaleString('ja-JP')} characters`)
  }
  if (field.type === 'number') {
    if (typeof field.min === 'number' && typeof field.max === 'number') {
      parts.push(`${field.min}–${field.max}`)
    } else if (typeof field.min === 'number') {
      parts.push(`≥ ${field.min}`)
    } else if (typeof field.max === 'number') {
      parts.push(`≤ ${field.max}`)
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export function shouldShowTechnicalDescription(field: FieldSchema): boolean {
  if (!field.description || isNsfwChecker(field)) return false
  return field.description !== conciseFieldDescription(field)
}

export function isAdvancedField(field: FieldSchema): boolean {
  if (field.required) return false
  const name = normalizedName(field.name)
  if (CORE_FIELD_NAMES.has(name)) return false
  if (
    field.type === 'reference' ||
    field.type === 'kling_elements' ||
    field.type === 'textarea'
  ) return false
  return true
}

export function modelInputSummary(model: ModelDefinition): string {
  const accepts = model.fields
    .filter((field) => field.type === 'reference')
    .map((field) => field.accept ?? field.name)
    .join(' ')
  const image = /image/i.test(accepts)
  const video = /video/i.test(accepts)
  const audio = /audio/i.test(accepts)
  const media = [image ? 'Image' : '', video ? 'Video' : '', audio ? 'Audio' : '']
    .filter(Boolean)
  return media.length > 0 ? `${media.join(' · ')} input` : 'Text input'
}
