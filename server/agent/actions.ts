import { assertPlainObject } from '../kie/safe.ts'
import { getProviderAdapter } from '../kie/adapters/index.ts'
import { getCredits } from '../kie/common.ts'
import type { ModelDefinition, Operation, Provider } from '../kie/types.ts'
import { archiveTaskMedia } from '../media/archiver.ts'
import { listMergedModels } from '../catalog/models.ts'
import {
  getHistoryItem,
  listHistory,
  updateMediaLocalPaths,
} from '../db/history.ts'
import { mirrorTaskIntoHistory, recordCreatedTask } from '../db/recordTask.ts'
import { GrokCliError, optimizePromptWithGrok } from '../grok/cli.ts'
import { StudioAgentError } from './errors.ts'

const MAX_WORKFLOW_ITEMS = 30

export interface WorkflowSummary {
  id: string
  model: string
  title: string
  category: string
  provider: string
  operation: string
  useCase: string | null
  tags: string[]
  requiredFields: string[]
  optionalFields: string[]
  docsUrl: string | null
}

function workflowSummary(model: ModelDefinition): WorkflowSummary {
  return {
    id: model.id,
    model: model.model,
    title: model.title,
    category: model.category,
    provider: model.provider,
    operation: model.operation ?? 'generate',
    useCase: model.useCase ?? null,
    tags: model.tags ?? [],
    requiredFields: model.fields.filter((f) => f.required).map((f) => f.name),
    optionalFields: model.fields.filter((f) => !f.required).map((f) => f.name),
    docsUrl: model.docsUrl ?? null,
  }
}

async function requireCatalog(): Promise<{ models: ModelDefinition[] }> {
  const merged = await listMergedModels()
  if (!merged) {
    throw new StudioAgentError(
      'Catalog not found. Wait for startup sync or run npm run sync:models',
      503,
    )
  }
  return merged
}

export async function listWorkflows(params: {
  category?: string
  capability?: string
  q?: string
}): Promise<{ total: number; items: WorkflowSummary[]; note?: string }> {
  const { models } = await requireCatalog()
  const category = params.category
  const capability = params.capability?.toLowerCase()
  const q = params.q?.toLowerCase()
  let filtered = models
  if (category === 'image' || category === 'video' || category === 'audio') {
    filtered = filtered.filter((m) => m.category === category)
  }
  if (capability) {
    filtered = filtered.filter((m) =>
      `${m.title} ${m.useCase ?? ''} ${(m.tags ?? []).join(' ')} ${m.model}`
        .toLowerCase()
        .includes(capability),
    )
  }
  if (q) {
    filtered = filtered.filter((m) =>
      `${m.id} ${m.title} ${m.model} ${(m.tags ?? []).join(' ')}`
        .toLowerCase()
        .includes(q),
    )
  }
  const items = filtered.map(workflowSummary)
  const trimmed = items.slice(0, MAX_WORKFLOW_ITEMS)
  return {
    total: items.length,
    items: trimmed,
    ...(items.length > MAX_WORKFLOW_ITEMS
      ? { note: `${items.length - MAX_WORKFLOW_ITEMS} more. Narrow down with capability or q.` }
      : {}),
  }
}

export async function getWorkflowSchema(id: string): Promise<ModelDefinition> {
  const { models } = await requireCatalog()
  const model =
    models.find((m) => m.id === id) ?? models.find((m) => m.model === id)
  if (!model) throw new StudioAgentError(`workflow not found: ${id}`, 404)
  return model
}

export async function generateMedia(input: {
  workflowId: string
  params: Record<string, unknown>
  title?: string
}): Promise<{ taskId: string; workflow: string; note: string; schema: ModelDefinition }> {
  const schema = await getWorkflowSchema(input.workflowId)
  assertPlainObject(input.params, 'input')
  const operation: Operation = schema.operation ?? 'generate'
  const adapter = getProviderAdapter(schema.provider)
  const created = await adapter.create({
    provider: schema.provider,
    operation,
    model: schema.model,
    input: input.params,
  })
  await recordCreatedTask({
    provider: schema.provider,
    operation,
    model: schema.model,
    input: input.params,
    created,
    workflowId: schema.id,
    title: input.title,
  })
  return {
    taskId: created.taskId,
    workflow: schema.title,
    note: 'Generation started. Results will also appear in the history gallery. Use get-task-status to check completion.',
    schema,
  }
}

function asProvider(value: string | undefined): Provider {
  switch (value) {
    case 'market':
    case 'suno':
    case 'veo':
    case 'runway':
      return value
    default:
      return 'market'
  }
}

function asOperation(value: string | undefined): Operation {
  switch (value) {
    case 'generate':
    case 'extend':
    case 'upload-cover':
    case 'upload-extend':
    case 'replace-section':
    case 'cover-art':
    case 'lyrics':
    case 'upscale-1080p':
    case 'upscale-4k':
    case 'aleph':
      return value
    default:
      return 'generate'
  }
}

export async function getTaskStatus(params: {
  taskId: string
  provider?: string
  operation?: string
}) {
  const item = getHistoryItem(params.taskId)
  // History is the source of truth: a hallucinated market/generate must not
  // override the adapter used when the task was created.
  const provider = asProvider(item?.provider ?? params.provider)
  const operation = asOperation(item?.operation ?? params.operation)
  const task = await getProviderAdapter(provider).getTask(params.taskId, operation)

  if (
    (task.state === 'success' || task.state === 'partial') &&
    task.media.some((m) => (m.url ?? m.streamUrl) && !m.localPath)
  ) {
    void archiveTaskMedia(params.taskId, task.media)
      .then((archived) => updateMediaLocalPaths(params.taskId, archived))
      .catch((err) => console.error('[media-archive]', params.taskId, err))
  }

  mirrorTaskIntoHistory(task)
  return task
}

export function searchHistory(params: {
  q?: string
  category?: string
  limit?: number
}) {
  const q = params.q?.toLowerCase()
  const category = params.category
  const limitRaw = params.limit ?? 10
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10
  let items = listHistory()
  if (category === 'image' || category === 'video' || category === 'audio') {
    items = items.filter((item) => item.category === category)
  }
  if (q) {
    items = items.filter((item) =>
      `${item.taskId} ${item.model} ${item.prompt ?? ''}`.toLowerCase().includes(q),
    )
  }
  return {
    items: items.slice(0, limit).map((item) => ({
      taskId: item.taskId,
      model: item.model,
      category: item.category,
      state: item.state,
      createdAt: item.createdAt,
      resultUrls: item.resultUrls ?? [],
      prompt: item.prompt?.slice(0, 200) ?? null,
      provider: item.provider ?? 'market',
      operation: item.operation ?? 'generate',
    })),
  }
}

export function getTaskInput(taskId: string) {
  const item = getHistoryItem(taskId)
  if (!item) throw new StudioAgentError('Task not found', 404)
  return {
    taskId: item.taskId,
    model: item.model,
    modelId: item.modelId ?? null,
    provider: item.provider ?? 'market',
    operation: item.operation ?? 'generate',
    input: item.input ?? null,
    prompt: item.prompt ?? null,
    state: item.state,
  }
}

export async function readCreditBalance(): Promise<{ credits: number }> {
  const credits = await getCredits()
  return { credits }
}

export async function optimizePrompt(input: {
  prompt: string
  modelId?: string
}): Promise<{ optimizedPrompt: string }> {
  try {
    const result = await optimizePromptWithGrok({
      prompt: input.prompt,
      modelId: input.modelId,
      mode: 'optimize',
    })
    return { optimizedPrompt: result.optimizedPrompt }
  } catch (error) {
    if (error instanceof GrokCliError && error.code === 'unavailable') {
      throw new StudioAgentError(
        'Prompt optimization is currently unavailable (Grok CLI not installed). Polish the prompt manually and proceed.',
        503,
      )
    }
    throw error
  }
}
