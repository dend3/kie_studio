import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'
import { generateTask } from './api.ts'
import { classifyApiError, type SubmissionQueue } from './submissionQueue.ts'
import { focusFirstFieldError, validateFields } from './form.ts'
import {
  sanitizeWorkflowInput,
  validateWorkflowInput,
} from './workflowValidation.ts'
import { parentTaskIdFor } from './taskRelations.ts'
import { upsertInList } from './history.ts'
import type { HistoryPersistMode } from './useHistoryPersistence.ts'
import type { MobileStudioView } from '../components/shell/StudioShell.tsx'
import type { HistoryItem, ModelDefinition } from './models/types.ts'

export type GenerateVars =
  | { source: 'form' }
  | { source: 'retry'; item: HistoryItem }

function promptFromInput(input: Record<string, unknown>): string | undefined {
  const p = input.prompt ?? input.text
  return typeof p === 'string' ? p.slice(0, 120) : undefined
}

interface UseGenerateFlowOptions {
  hasApiKey: boolean
  selected: ModelDefinition | undefined
  values: Record<string, unknown>
  batchCount: number
  submissionQueue: SubmissionQueue
  setFormError: Dispatch<SetStateAction<string | null>>
  setFieldErrors: Dispatch<SetStateAction<Record<string, string>>>
  setHistory: Dispatch<SetStateAction<HistoryItem[]>>
  requestHistoryPersist: (mode?: HistoryPersistMode) => void
  setViewerTaskId: Dispatch<SetStateAction<string | null>>
  setMobileView: Dispatch<SetStateAction<MobileStudioView>>
  setCreditPurchaseSheetOpen: Dispatch<SetStateAction<boolean>>
}

/**
 * 生成 mutation（送信前検証・submissionQueue 連携・履歴反映・
 * クレジット不足時の購入シート誘導）をまとめて管理する。
 */
export function useGenerateFlow({
  hasApiKey,
  selected,
  values,
  batchCount,
  submissionQueue,
  setFormError,
  setFieldErrors,
  setHistory,
  requestHistoryPersist,
  setViewerTaskId,
  setMobileView,
  setCreditPurchaseSheetOpen,
}: UseGenerateFlowOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: GenerateVars) => {
      if (!hasApiKey) {
        throw new Error('API key not set. Save KIE_API_KEY in Settings')
      }
      setFormError(null)

      // 失敗履歴からのリトライ: 保存済み入力をそのまま再送信
      if (vars.source === 'retry') {
        const { item } = vars
        if (!item.input) {
          throw new Error('No input data saved for this history item')
        }
        const provider = item.provider ?? 'market'
        const operation = item.operation ?? 'generate'
        const res = await submissionQueue.enqueue({
          provider,
          operation,
          model: item.model,
          run: () => generateTask({
            model: item.model,
            input: item.input as Record<string, unknown>,
            provider,
            operation,
          }),
        })
        return {
          tasks: [{ taskId: res.data.taskId, input: item.input, normalized: res.data.task }],
          model: item.model,
          category: item.category,
          modelId: item.modelId,
          provider,
          operation,
          parentTaskId: item.parentTaskId,
          failedCount: 0,
          insufficientCredits: false,
        }
      }

      if (!selected) throw new Error('No model selected')

      const errors = {
        ...validateFields(selected.fields, values),
        ...validateWorkflowInput(selected, values),
      }
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors)
        focusFirstFieldError(errors)
        throw new Error('Please check your inputs')
      }
      setFieldErrors({})

      let input: Record<string, unknown> = {}
      for (const field of selected.fields) {
        const v = values[field.name]
        if (v === undefined || v === '') continue
        if (field.type === 'reference' && Array.isArray(v) && v.length === 0) {
          continue
        }
        if (
          field.type === 'reference' &&
          field.scalar &&
          Array.isArray(v)
        ) {
          const first = v.find((u) => typeof u === 'string' && u.length > 0)
          if (typeof first !== 'string') continue
          input[field.name] = first
          continue
        }
        if (field.type === 'kling_elements' && Array.isArray(v)) {
          const cleaned = v.filter(
            (el) =>
              el &&
              typeof el === 'object' &&
              typeof (el as { name?: string }).name === 'string' &&
              (el as { name: string }).name.trim() &&
              Array.isArray(
                (el as { element_input_urls?: string[] }).element_input_urls,
              ) &&
              ((el as { element_input_urls: string[] }).element_input_urls
                ?.length ?? 0) >= 1,
          )
          if (cleaned.length === 0) continue
          input[field.name] = cleaned
          continue
        }
        input[field.name] = v
      }

      input = sanitizeWorkflowInput(selected, input)

      const model = selected
      const parentTaskId = parentTaskIdFor(model.operation ?? 'generate', input)
      delete input._duration
      delete input._parentTaskId
      const count = Math.max(1, Math.min(4, batchCount))
      const segmentInputs = model.id === 'market/elevenlabs-tts' && typeof input.text === 'string'
        ? input.text
            .split(/\n\s*\n/g)
            .map((text) => text.trim())
            .filter(Boolean)
            .map((text, index, segments) => ({
              ...input,
              text,
              previous_text: segments[index - 1] ?? input.previous_text,
              next_text: segments[index + 1] ?? input.next_text,
            }))
        : [input]
      const requestInputs = Array.from(
        { length: count },
        () => segmentInputs,
      ).flat()
      const settled = await Promise.allSettled(
        requestInputs.map((requestInput) =>
          submissionQueue.enqueue({
            provider: model.provider,
            operation: model.operation ?? 'generate',
            model: model.model,
            run: () => generateTask({
              model: model.model,
              input: requestInput,
              provider: model.provider,
              operation: model.operation ?? 'generate',
            }),
          }),
        ),
      )
      const tasks = settled.flatMap((result, index) =>
        result.status === 'fulfilled'
          ? [{
              taskId: result.value.data.taskId,
              input: requestInputs[index] as Record<string, unknown>,
              normalized: result.value.data.task,
            }]
          : [],
      )
      const creditError = settled.find(
        (r): r is PromiseRejectedResult =>
          r.status === 'rejected' && classifyApiError(r.reason) === 'purchase',
      )
      if (tasks.length === 0) {
        const first = creditError ?? (settled[0] as PromiseRejectedResult)
        throw first.reason instanceof Error
          ? first.reason
          : new Error('Generation request failed')
      }
      return {
        tasks,
        model: model.model,
        category: model.category,
        modelId: model.id,
        provider: model.provider,
        operation: model.operation ?? 'generate',
        parentTaskId,
        failedCount: requestInputs.length - tasks.length,
        insufficientCredits: Boolean(creditError),
      }
    },
    onSuccess: ({
      tasks,
      model,
      category,
      modelId,
      provider,
      operation,
      parentTaskId,
      failedCount,
      insufficientCredits,
    }) => {
      setMobileView('history')
      const now = Date.now()
      setHistory((prev) => {
        let next = prev
        for (const task of tasks) {
          const item: HistoryItem = {
            taskId: task.taskId,
            model,
            category,
            state: task.normalized?.state ?? 'waiting',
            createdAt: now,
            prompt: promptFromInput(task.input),
            modelId,
            input: task.input,
            provider,
            operation,
            parentTaskId,
            resultUrls: task.normalized?.resultUrls,
            media: task.normalized?.media,
            providerStatus: task.normalized?.providerStatus,
            partial: task.normalized?.partial,
            expiresAt: task.normalized?.expiresAt,
            creditsConsumed: task.normalized?.creditsConsumed,
            failMsg: task.normalized?.failMsg,
            rawParam: task.normalized?.rawParam,
            rawResult: task.normalized?.rawResult,
          }
          next = upsertInList(next, item)
        }
        return next
      })
      requestHistoryPersist('immediate')
      if (tasks.length === 1) setViewerTaskId(tasks[0]?.taskId ?? null)
      if (failedCount > 0) {
        setFormError(
          `Sent ${tasks.length} (${failedCount} failed to send)${
            insufficientCredits ? '. Credits may be insufficient' : ''
          }`,
        )
        if (insufficientCredits) {
          setCreditPurchaseSheetOpen(true)
          void queryClient.invalidateQueries({ queryKey: ['credits'] })
        }
      }
    },
    onError: (e) => {
      const action = classifyApiError(e)
      const base = e instanceof Error ? e.message : 'Generation failed'
      setFormError(
        action === 'refunded'
          ? `${base}. Credits have been refunded. Balance updated`
          : action === 'fix-input'
            ? `${base}. Fix your inputs and send again`
            : base,
      )
      if (action === 'purchase') {
        setCreditPurchaseSheetOpen(true)
        void queryClient.invalidateQueries({ queryKey: ['credits'] })
      }
      if (action === 'refunded') {
        void queryClient.invalidateQueries({ queryKey: ['credits'] })
      }
    },
  })
}
