import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseGrokModelsOutput,
  pickOptimizeGrokModel,
  type GrokModelCatalog,
} from './optimize-model.ts'
import {
  formatProfileRulesMarkdown,
  getOptimizeProfile,
  type OptimizeFamily,
  type OptimizeProfile,
} from './optimize-profiles.ts'

const STATUS_CACHE_MS = 60_000
const MODEL_CATALOG_CACHE_MS = 10 * 60_000
const MODELS_TIMEOUT_MS = 30_000
const OPTIMIZE_TIMEOUT_MS = 120_000

const OPT_START = '<<<OPTIMIZED>>>'
const OPT_END = '<<<END>>>'

export type { GrokModelCatalog }
export { parseGrokModelsOutput, pickOptimizeGrokModel }

export function buildOptimizeGrokArgs(
  workDir: string,
  headlessPrompt: string,
  model: string,
): string[] {
  return [
    '--no-auto-update',
    '--cwd',
    workDir,
    '-m',
    model,
    '-p',
    headlessPrompt,
    '--output-format',
    'plain',
  ]
}

export class GrokCliError extends Error {
  readonly code?: 'unavailable' | 'timeout' | 'failed' | 'empty'

  constructor(
    message: string,
    code?: 'unavailable' | 'timeout' | 'failed' | 'empty',
  ) {
    super(message)
    this.name = 'GrokCliError'
    this.code = code
  }
}

type StatusCache = {
  at: number
  available: boolean
  version?: string
}

type ModelCatalogCache = {
  at: number
  version?: string
  catalog: GrokModelCatalog
}

let statusCache: StatusCache | null = null
let modelCatalogCache: ModelCatalogCache | null = null

function killProcessTree(child: ReturnType<typeof spawn>) {
  if (child.pid == null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    return
  }
  child.kill('SIGKILL')
}

function runGrok(
  args: string[],
  options?: { timeoutMs?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const timeoutMs = options?.timeoutMs ?? 15_000

  return new Promise((resolvePromise, reject) => {
    const child = spawn('grok', args, {
      shell: false,
      windowsHide: true,
      cwd: options?.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killProcessTree(child)
      reject(new GrokCliError('Grok Build response timed out', 'timeout'))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const notFound =
        'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
      reject(
        new GrokCliError(
          notFound
            ? 'Grok Build is not installed'
            : `Could not start Grok Build: ${err.message}`,
          'unavailable',
        ),
      )
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ stdout, stderr, code })
    })
  })
}

type GrokRunner = typeof runGrok
let grokRunner: GrokRunner = runGrok

export function setGrokRunnerForTests(runner: GrokRunner | null): void {
  grokRunner = runner ?? runGrok
  statusCache = null
  modelCatalogCache = null
}

export function clearGrokStatusCacheForTests(): void {
  statusCache = null
}

export async function getGrokStatus(options?: {
  force?: boolean
}): Promise<{ available: boolean; version?: string }> {
  const now = Date.now()
  if (
    !options?.force &&
    statusCache &&
    now - statusCache.at < STATUS_CACHE_MS
  ) {
    return {
      available: statusCache.available,
      version: statusCache.version,
    }
  }

  try {
    const { stdout, stderr, code } = await grokRunner(['--version'], {
      timeoutMs: 10_000,
    })
    const text = `${stdout}\n${stderr}`.trim()
    const available = code === 0 || /grok/i.test(text)
    const versionMatch = text.match(/(\d+\.\d+(?:\.\d+)?[^\s]*)/)
    const version = versionMatch?.[1]
    statusCache = { at: now, available, version }
    return { available, version }
  } catch {
    statusCache = { at: now, available: false }
    return { available: false }
  }
}

async function fetchGrokModelCatalog(): Promise<GrokModelCatalog> {
  const { stdout, stderr, code } = await grokRunner(
    ['--no-auto-update', 'models'],
    { timeoutMs: MODELS_TIMEOUT_MS },
  )
  const text = `${stdout}\n${stderr}`
  const catalog = parseGrokModelsOutput(text)
  if (catalog.defaultModel || catalog.ids.length > 0) return catalog

  const detail = text.trim() || `exit code ${code}`
  throw new GrokCliError(
    `Could not fetch Grok CLI model list: ${detail.slice(0, 500)}`,
    'failed',
  )
}

export async function getGrokModelCatalog(options?: {
  force?: boolean
}): Promise<GrokModelCatalog> {
  const status = await getGrokStatus()
  const now = Date.now()
  if (
    !options?.force &&
    modelCatalogCache &&
    now - modelCatalogCache.at < MODEL_CATALOG_CACHE_MS &&
    modelCatalogCache.version === status.version
  ) {
    return modelCatalogCache.catalog
  }

  const catalog = await fetchGrokModelCatalog()
  modelCatalogCache = { at: now, version: status.version, catalog }
  return catalog
}

export async function resolveOptimizeGrokModel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const override = env.STUDIO_GROK_OPTIMIZE_MODEL?.trim() || undefined
  const catalog = await getGrokModelCatalog()
  try {
    return pickOptimizeGrokModel(catalog, override)
  } catch (e) {
    throw new GrokCliError(
      e instanceof Error ? e.message : 'Could not resolve the optimization model',
      'failed',
    )
  }
}

export type PromptAssistMode = 'generate' | 'optimize'

function formatOutputMentionRule(
  family: OptimizeFamily,
  mode: PromptAssistMode,
): string {
  if (family === 'minimax-h3') {
    return mode === 'generate'
      ? '- Studio の参照タグはユーザー意図に含まれる場合のみ使い、同じ番号の <Picture N> / <Video N> / <Audio N> を併用する。無い番号は捏造しない。'
      : '- 入力の Studio タグ（@imageN / @VideoN / @AudioN）は形式と番号を維持し、公式の <Picture N> / <Video N> / <Audio N> を同じ番号で併用する。'
  }
  if (family === 'wan') {
    return mode === 'generate'
      ? '- Studio の参照タグはユーザー意図に含まれる場合のみ使い、同じ番号の Image n / Video n を併用する。無い番号は捏造しない。'
      : '- 入力の Studio タグ（@imageN / @VideoN）は形式と番号を維持し、公式の Image n / Video n を同じ番号で併用する。'
  }
  return mode === 'generate'
    ? '- 参照タグはユーザー意図に含まれる場合のみ使い、勝手に番号を捏造しない。'
    : '- 入力にあった参照タグ（@image / [Image N] / @element 等）は形式と番号を維持する。'
}

function buildAssistRequest(params: {
  mode: PromptAssistMode
  prompt: string
  customInstructions?: string
  modelId?: string
  profile: OptimizeProfile
  guideFileName?: string
}): string {
  const custom = params.customInstructions?.trim()
  const modelLine = params.modelId
    ? `対象モデル ID: ${params.modelId}`
    : '対象モデル: （未指定）'
  const isGenerate = params.mode === 'generate'

  const guideInstruction = params.guideFileName
    ? `同じ作業ディレクトリの ${params.guideFileName} を読み、そのガイドを最優先で従う。下記プロファイルは補足とする。`
    : isGenerate
      ? '下記の最適化プロファイルに従って、本番品質のプロンプトを一から作成する。'
      : '下記の最適化プロファイルに従って下書きプロンプトを改善する。'

  const role =
    params.profile.modality === 'video'
      ? isGenerate
        ? 'あなたは動画生成向けプロンプト作成アシスタントです。'
        : 'あなたは動画生成向けプロンプト最適化アシスタントです。'
      : isGenerate
        ? 'あなたは画像生成向けプロンプト作成アシスタントです。'
        : 'あなたは画像生成向けプロンプト最適化アシスタントです。'

  const intentSection = isGenerate
    ? [
        '## ユーザーの意図・メモ（これを元にプロンプトを作成）',
        custom ?? '',
        '',
      ].join('\n')
    : [
        custom
          ? ['## ユーザーのカスタム指示（最優先で反映）', custom, ''].join('\n')
          : '',
        '## 最適化対象のプロンプト',
        params.prompt,
        '',
      ]
        .filter((line) => line !== '')
        .join('\n')

  return [
    role,
    guideInstruction,
    '',
    modelLine,
    '',
    formatProfileRulesMarkdown(params.profile),
    '',
    intentSection,
    '## 出力ルール',
    isGenerate
      ? '- 完成したプロンプト本文のみを出力する。'
      : '- 最適化後のプロンプト本文のみを出力する。',
    '- 説明・前置き・箇条書きの解説は禁止。',
    formatOutputMentionRule(params.profile.family, params.mode),
    `- 必ず次のマーカーで囲む: ${OPT_START} と ${OPT_END}`,
    '- マーカーの外側には何も書かない。',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function extractOptimized(raw: string): string {
  const start = raw.indexOf(OPT_START)
  const end = raw.indexOf(OPT_END)
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start + OPT_START.length, end).trim()
  }
  const fenced = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) return fenced[1].trim()
  return raw.trim()
}

export async function optimizePromptWithGrok(params: {
  prompt?: string
  customInstructions?: string
  modelId?: string
  mode?: PromptAssistMode
}): Promise<{
  optimizedPrompt: string
  profile: OptimizeProfile
  mode: PromptAssistMode
}> {
  const status = await getGrokStatus()
  if (!status.available) {
    throw new GrokCliError(
      'Grok Build is not installed',
      'unavailable',
    )
  }

  const prompt = params.prompt?.trim() ?? ''
  const custom = params.customInstructions?.trim() ?? ''
  const mode: PromptAssistMode =
    params.mode ?? (prompt ? 'optimize' : 'generate')

  if (mode === 'optimize' && !prompt) {
    throw new GrokCliError('A prompt is required for optimization', 'empty')
  }
  if (mode === 'generate' && !custom) {
    throw new GrokCliError(
      'Custom instructions (notes on what you want) are required for prompt generation',
      'empty',
    )
  }

  const profile = getOptimizeProfile(params.modelId)
  const workDir = await mkdtemp(join(tmpdir(), 'kie-optimize-'))
  const requestPath = join(workDir, 'optimize-request.md')
  const guide = profile.guide
  const guideFileName = guide?.fileName

  try {
    if (guide) {
      await writeFile(join(workDir, guide.fileName), guide.content, 'utf8')
    }

    await writeFile(
      requestPath,
      buildAssistRequest({
        mode,
        prompt,
        customInstructions: custom || undefined,
        modelId: params.modelId,
        profile,
        guideFileName,
      }),
      'utf8',
    )

    const fileMentions = guideFileName
      ? `@optimize-request.md and @${guideFileName}`
      : '@optimize-request.md'

    const headlessPrompt = [
      `Read ${fileMentions}.`,
      'Follow the request file exactly.',
      `Reply with only the ${mode === 'generate' ? 'generated' : 'optimized'} prompt wrapped in ${OPT_START} and ${OPT_END}.`,
      'Do not use tools other than reading those files. Do not explain.',
    ].join(' ')

    const model = await resolveOptimizeGrokModel()
    const result = await grokRunner(
      buildOptimizeGrokArgs(workDir, headlessPrompt, model),
      { timeoutMs: OPTIMIZE_TIMEOUT_MS, cwd: workDir },
    )

    if (result.code !== 0 && !result.stdout.trim()) {
      const detail = result.stderr.trim() || `exit code ${result.code}`
      throw new GrokCliError(
        `Grok Build execution failed: ${detail}`,
        'failed',
      )
    }

    const optimized = extractOptimized(result.stdout || result.stderr)
    if (!optimized) {
      throw new GrokCliError(
        mode === 'generate' ? 'Generation result was empty' : 'Optimization result was empty',
        'empty',
      )
    }
    return { optimizedPrompt: optimized, profile, mode }
  } catch (e) {
    if (e instanceof GrokCliError) throw e
    throw new GrokCliError(
      e instanceof Error ? e.message : 'Grok Build execution failed',
      'failed',
    )
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
