import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai'
import {
  getAgentConversation,
  saveAgentMessages,
  touchAgentConversation,
  upsertAgentConversation,
} from '../db/agentConversations.ts'
import { AgentModelError } from './errors.ts'
import type { MediaTaskData } from './mediaTask.ts'
import { resolveLanguageModel } from './resolveModel.ts'
import { STUDIO_SYSTEM_PROMPT } from './systemPrompt.ts'
import { createStudioTools } from './tools.ts'

export type StudioUIMessage = UIMessage<unknown, { 'media-task': MediaTaskData }>

const MAX_STEPS = 12

function firstUserText(messages: StudioUIMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) return part.text.trim()
    }
  }
  return 'New conversation'
}

function conversationTitle(text: string): string {
  return text.length > 32 ? `${text.slice(0, 32)}…` : text
}

export async function streamStudioChat(input: {
  conversationId: string
  provider: string
  model: string
  messages: StudioUIMessage[]
  abortSignal?: AbortSignal
}): Promise<Response> {
  const languageModel = resolveLanguageModel(input.provider, input.model)
  const existing = getAgentConversation(input.conversationId)
  if (!existing) {
    upsertAgentConversation({
      id: input.conversationId,
      title: conversationTitle(firstUserText(input.messages)),
      provider: input.provider,
      model: input.model,
    })
  }

  const stream = createUIMessageStream<StudioUIMessage>({
    originalMessages: input.messages,
    execute: async ({ writer }) => {
      const result = streamText({
        model: languageModel,
        system: STUDIO_SYSTEM_PROMPT,
        messages: await convertToModelMessages(input.messages, {
          convertDataPart: () => undefined,
        }),
        tools: createStudioTools({
          onMediaTask: (data) => {
            writer.write({
              type: 'data-media-task',
              id: data.taskId,
              data,
            })
          },
        }),
        abortSignal: input.abortSignal,
        stopWhen: stepCountIs(MAX_STEPS),
      })
      writer.merge(result.toUIMessageStream())
    },
    onError: (error) => {
      if (error instanceof AgentModelError) return error.message
      if (error instanceof Error && error.message.trim()) return error.message
      return 'Agent response failed'
    },
    onFinish: ({ messages }) => {
      saveAgentMessages(input.conversationId, messages)
      touchAgentConversation(input.conversationId)
    },
  })

  return createUIMessageStreamResponse({ stream })
}
