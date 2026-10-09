import { tool } from 'ai'
import { z } from 'zod'
import type { MediaTaskData } from './mediaTask.ts'
import { errorMessage, StudioAgentError } from './errors.ts'
import * as actions from './actions.ts'

export interface StudioToolHooks {
  onMediaTask?: (data: MediaTaskData) => void
}

export function createStudioTools(hooks: StudioToolHooks = {}) {
  return {
    'list-workflows': tool({
      description:
        'List available image/video/audio generation workflows (models). Filter by category (image/video/audio) or capability (e.g. lip-sync, upscale, tts). Always check candidates here before generating.',
      inputSchema: z.object({
        category: z.enum(['image', 'video', 'audio']).optional(),
        capability: z.string().optional(),
        q: z.string().optional(),
      }),
      execute: async (data) => {
        return actions.listWorkflows(data)
      },
    }),
    'get-workflow-schema': tool({
      description:
        'Get a workflow input schema (required/optional parameters, types, options, defaults). Always call this before generate-media; never fill in parameters by guessing.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        try {
          const schema = await actions.getWorkflowSchema(id)
          return {
            id: schema.id,
            model: schema.model,
            title: schema.title,
            category: schema.category,
            provider: schema.provider,
            operation: schema.operation ?? 'generate',
            useCase: schema.useCase ?? null,
            docsUrl: schema.docsUrl ?? null,
            fields: schema.fields.map((f) => ({
              name: f.name,
              type: f.type,
              label: f.label,
              required: f.required === true,
              ...(f.default !== undefined ? { default: f.default } : {}),
              ...(f.enum ? { enum: f.enum } : {}),
              ...(f.description ? { description: f.description } : {}),
              ...(f.accept ? { accept: f.accept } : {}),
              ...(f.maxLength ? { maxLength: f.maxLength } : {}),
              ...(f.min !== undefined ? { min: f.min } : {}),
              ...(f.max !== undefined ? { max: f.max } : {}),
            })),
          }
        } catch (error) {
          return `Workflow not found: ${errorMessage(error)}`
        }
      },
    }),
    'generate-media': tool({
      description:
        'Create an image/video/audio generation task. Required: workflowId and input. Before running, present the model, key parameters, and expected credit cost to the user and get their confirmation. Pass the returned taskId / provider / operation to get-task-status (generation is asynchronous).',
      inputSchema: z.object({
        workflowId: z.string(),
        input: z.record(z.string(), z.unknown()),
        title: z.string().optional(),
      }),
      execute: async (data) => {
        try {
          const created = await actions.generateMedia({
            workflowId: data.workflowId,
            params: data.input,
            title: data.title,
          })
          hooks.onMediaTask?.({
            taskId: created.taskId,
            title: data.title ?? created.schema.title,
            workflowId: created.schema.id,
            status: 'submitted',
          })
          return {
            taskId: created.taskId,
            workflow: created.workflow,
            provider: created.schema.provider,
            operation: created.schema.operation ?? 'generate',
            note: created.note,
          }
        } catch (error) {
          return `Failed to start generation: ${errorMessage(error)}`
        }
      },
    }),
    'get-task-status': tool({
      description:
        'Check the status of a generation task. On success, returns URLs of the result media. Use the provider/operation returned by generate-media; if omitted, they are filled in from history.',
      inputSchema: z.object({
        taskId: z.string(),
        provider: z.string().optional(),
        operation: z.string().optional(),
      }),
      execute: async (data) => {
        try {
          const task = await actions.getTaskStatus(data)
          if (task.state === 'success' || task.state === 'partial') {
            hooks.onMediaTask?.({
              taskId: task.taskId,
              status: 'succeeded',
              resultUrls: task.resultUrls,
              media: task.media.map((m) => ({
                kind: m.kind,
                ...(m.url ? { url: m.url } : {}),
                ...(m.localPath ? { localPath: m.localPath } : {}),
              })),
            })
          } else if (task.state === 'fail') {
            hooks.onMediaTask?.({
              taskId: task.taskId,
              status: 'failed',
              error: task.failMsg ?? 'Unknown error',
            })
          }
          return {
            taskId: task.taskId,
            state: task.state,
            provider: task.provider,
            operation: task.operation,
            resultUrls: task.resultUrls,
            ...(task.failMsg ? { failMsg: task.failMsg } : {}),
            ...(task.creditsConsumed !== undefined
              ? { creditsConsumed: task.creditsConsumed }
              : {}),
          }
        } catch (error) {
          return `Failed to check status: ${errorMessage(error)}`
        }
      },
    }),
    'search-history': tool({
      description: 'Search past generation history. Searchable by task ID, model name, and prompt content.',
      inputSchema: z.object({
        q: z.string().optional(),
        category: z.enum(['image', 'video', 'audio']).optional(),
        limit: z.number().optional(),
      }),
      execute: async (data) => actions.searchHistory(data),
    }),
    'get-task-input': tool({
      description:
        'Get the input parameters of a past task. Use as a base for re-running with extension, regeneration, or parameter changes.',
      inputSchema: z.object({ taskId: z.string() }),
      execute: async ({ taskId }) => {
        try {
          return actions.getTaskInput(taskId)
        } catch (error) {
          return `Task not found: ${errorMessage(error)}`
        }
      },
    }),
    'get-credit-balance': tool({
      description: 'Check the kie.ai credit balance. Useful to check before high-cost generations.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await actions.readCreditBalance()
        } catch (error) {
          return `Failed to check balance: ${errorMessage(error)}`
        }
      },
    }),
    'optimize-prompt': tool({
      description:
        'Optimize a prompt for the target model (uses Grok CLI). After hearing the user intent, suggest it as a pre-generation polish step.',
      inputSchema: z.object({
        prompt: z.string(),
        modelId: z.string().optional(),
      }),
      execute: async (data) => {
        try {
          return await actions.optimizePrompt(data)
        } catch (error) {
          if (error instanceof StudioAgentError && error.status === 503) {
            return error.message
          }
          return `Prompt optimization failed: ${errorMessage(error)}`
        }
      },
    }),
  }
}
