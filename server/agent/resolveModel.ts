import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'
import {
  customEndpointProviderId,
  isBuiltinLlmProvider,
  type BuiltinLlmProvider,
} from '../../src/lib/models/llmProviders.ts'
import { getCustomLlmEndpoints, getLlmApiKey } from '../settings/llmKeys.ts'
import { AgentModelError } from './errors.ts'

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

function builtinModel(provider: BuiltinLlmProvider, model: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model)
    case 'xai':
      return createXai({ apiKey })(model)
    case 'openai':
      return createOpenAI({ apiKey })(model)
    case 'anthropic':
      return createAnthropic({ apiKey })(model)
    case 'alibaba':
      return createOpenAI({ apiKey, baseURL: DASHSCOPE_BASE, name: 'alibaba' })(model)
    default: {
      const _never: never = provider
      throw new AgentModelError(`Unknown provider: ${_never}`)
    }
  }
}

export function resolveLanguageModel(provider: string, model: string): LanguageModel {
  const trimmedModel = model.trim()
  if (!trimmedModel) throw new AgentModelError('model is required')

  if (isBuiltinLlmProvider(provider)) {
    const apiKey = getLlmApiKey(provider)
    if (!apiKey) {
      throw new AgentModelError(
        `${provider} has no API key. Save the key in the settings screen.`,
      )
    }
    return builtinModel(provider, trimmedModel, apiKey)
  }

  if (!provider.startsWith('custom-')) {
    throw new AgentModelError(`Unknown provider: ${provider}`)
  }

  const endpointId = provider.slice('custom-'.length)
  const endpoints = getCustomLlmEndpoints()
  const endpoint =
    endpoints.find((item) => item.id === endpointId) ??
    endpoints.find((item) => customEndpointProviderId(item.id) === provider)
  if (!endpoint) {
    throw new AgentModelError(`Custom endpoint not found: ${endpointId}`)
  }
  if (!endpoint.apiKey.trim()) {
    throw new AgentModelError(
      `${endpoint.label} has no API key. Save the key in the settings screen.`,
    )
  }

  if (endpoint.kind === 'anthropic-compatible') {
    return createAnthropic({
      apiKey: endpoint.apiKey,
      baseURL: endpoint.baseUrl,
    })(trimmedModel)
  }
  return createOpenAI({
    apiKey: endpoint.apiKey,
    baseURL: endpoint.baseUrl,
    name: endpoint.label,
  })(trimmedModel)
}
