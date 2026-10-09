import type { FieldSchema, ModelDefinition } from '../kie/types.ts'
import { readCatalog } from './sync.ts'
import { DEDICATED_MODELS } from './dedicated.ts'

function withUseCase(model: ModelDefinition): ModelDefinition {
  if (model.useCase) return model
  const hay = `${model.title} ${model.model}`.toLowerCase()
  if (model.category === 'audio') {
    if (/dialogue|conversation/.test(hay)) return { ...model, useCase: 'Conversation' }
    if (/tts|speech|voice|narrat/.test(hay)) return { ...model, useCase: 'Narration' }
    if (/noise|separat|isolation|stem|enhance/.test(hay)) return { ...model, useCase: 'Audio processing' }
    return { ...model, useCase: 'Song' }
  }
  if (model.category === 'video') {
    if (/upscale|enhance|4k|1080/.test(hay)) return { ...model, useCase: 'Upscale' }
    if (/edit|video-to-video|lip.sync/.test(hay)) return { ...model, useCase: 'Video editing' }
    return { ...model, useCase: 'Video generation' }
  }
  if (/edit|image-to-image|inpaint|outpaint/.test(hay)) return { ...model, useCase: 'Image editing' }
  return { ...model, useCase: 'Image generation' }
}

function hydrateDedicatedModel(
  dedicated: ModelDefinition,
  catalogModels: ModelDefinition[],
): ModelDefinition {
  if (dedicated.provider !== 'market') return dedicated
  const catalogModel = catalogModels.find(
    (candidate) => candidate.provider === 'market' && candidate.model === dedicated.model,
  )
  if (!catalogModel) return dedicated

  const fields = catalogModel.fields.map((field): FieldSchema => {
    if (dedicated.id === 'market/elevenlabs-tts' && field.name === 'text') {
      return {
        ...field,
        label: 'Script',
        description: 'Splits into segments of up to 5000 characters, separated by blank lines',
        maxLength: 20_000,
      }
    }
    if (dedicated.id === 'market/elevenlabs-dialogue' && field.name === 'stability') {
      return { ...field, min: 0, max: 1, step: 0.5, default: 0.5 }
    }
    if (dedicated.id === 'market/volcengine-lip-sync' && field.name === 'video_url') {
      return { ...field, accept: 'video/*', maxItems: 1, scalar: true }
    }
    if (dedicated.id === 'market/volcengine-lip-sync' && field.name === 'audio_url') {
      return { ...field, accept: 'audio/*', maxItems: 1, scalar: true }
    }
    return field
  })

  return {
    ...catalogModel,
    id: dedicated.id,
    title: dedicated.title,
    operation: dedicated.operation,
    useCase: dedicated.useCase,
    tags: dedicated.tags,
    docsUrl: dedicated.docsUrl ?? catalogModel.docsUrl,
    fields,
  }
}

export interface MergedModelsResult {
  syncedAt: string | null
  source: string
  models: ModelDefinition[]
}

/** Dedicated workflows merged over the synced docs catalog (deduped, useCase-filled). */
export async function listMergedModels(): Promise<MergedModelsResult | null> {
  const catalog = await readCatalog()
  if (!catalog) return null
  const dedicatedModels = DEDICATED_MODELS.map((model) =>
    hydrateDedicatedModel(model, catalog.models),
  )
  const models = [...dedicatedModels, ...catalog.models]
    .filter(
      (model, index, items) =>
        items.findIndex(
          (item) => item.provider === model.provider && item.model === model.model,
        ) === index,
    )
    .map(withUseCase)
  return { syncedAt: catalog.syncedAt, source: catalog.source, models }
}