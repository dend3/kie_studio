export type GrokModelCatalog = {
  defaultModel?: string
  ids: string[]
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const DEFAULT_LINE_RE = /^Default model:\s+(\S+)/i
const ITEM_LINE_RE = /^\s*[-*]\s+(\S+)/

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/**
 * `grok models` のテキスト出力をパースする。
 * Grok Build pager（`list_available_models`）は次の形式で出す:
 *
 *   Default model: grok-4.6
 *
 *   Available models:
 *     * grok-4.6 (default)
 *     - grok-4.5
 */
export function parseGrokModelsOutput(raw: string): GrokModelCatalog {
  const ids: string[] = []
  let defaultModel: string | undefined

  for (const line of stripAnsi(raw).split(/\r?\n/)) {
    const defaultMatch = line.match(DEFAULT_LINE_RE)
    if (defaultMatch?.[1]) {
      defaultModel = defaultMatch[1]
      continue
    }
    const itemMatch = line.match(ITEM_LINE_RE)
    const id = itemMatch?.[1]
    if (!id) continue
    if (!ids.includes(id)) ids.push(id)
  }

  return { defaultModel, ids }
}

export function pickOptimizeGrokModel(
  catalog: GrokModelCatalog,
  override?: string,
): string {
  const trimmed = override?.trim()
  if (trimmed) {
    if (catalog.ids.length > 0 && !catalog.ids.includes(trimmed)) {
      throw new Error(
        `指定したモデル '${trimmed}'  is not in the Grok CLI list. Available: ${catalog.ids.join(', ')}`,
      )
    }
    return trimmed
  }

  if (
    catalog.defaultModel &&
    (catalog.ids.length === 0 || catalog.ids.includes(catalog.defaultModel))
  ) {
    return catalog.defaultModel
  }
  if (catalog.ids[0]) return catalog.ids[0]
  if (catalog.defaultModel) return catalog.defaultModel
  throw new Error(
    'Grok CLI のモデル一覧が空でした。`grok models` の出力を確認してください。',
  )
}
