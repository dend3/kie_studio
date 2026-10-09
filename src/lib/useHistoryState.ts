import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
} from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchHistory, importHistoryApi, putHistory, deleteHistoryItem, clearUnpinnedHistory } from './api.ts'
import {
  capItems,
  exportHistoryJson,
  MAX_PINNED,
  mergeServerHistory,
  parseHistoryJson,
  PENDING_STALE_MS,
  removeFromList,
  togglePinInList,
  upsertInList,
} from './history.ts'
import { useHistoryPersistence } from './useHistoryPersistence.ts'
import { useHistoryMigration } from './useHistoryMigration.ts'
import type { HistoryItem } from './models/types.ts'

interface UseHistoryStateOptions {
  setFormError: Dispatch<SetStateAction<string | null>>
  setFormNotice: Dispatch<SetStateAction<string | null>>
}

/**
 * 履歴の state・サーバー永続化・localStorage 移行・ピン留め・
 * インポート/エクスポートをまとめて管理する。
 */
export function useHistoryState({
  setFormError,
  setFormNotice,
}: UseHistoryStateOptions) {
  const queryClient = useQueryClient()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const historyRef = useRef<HistoryItem[]>([])
  const [historyPersistReady, setHistoryPersistReady] = useState(false)

  const historyQuery = useQuery({
    queryKey: ['history'],
    queryFn: async () => (await fetchHistory()).data.items,
    staleTime: Infinity,
  })

  const handleHistoryStored = useCallback(
    (items: HistoryItem[]) => {
      setHistory((previous) => mergeServerHistory(previous, items))
      queryClient.setQueryData(['history'], items)
    },
    [queryClient],
  )
  const handleHistoryRecovered = useCallback(
    (items: HistoryItem[]) => {
      setHistory(items)
      queryClient.setQueryData(['history'], items)
    },
    [queryClient],
  )
  const handleHistoryPersistError = useCallback(
    (error: unknown) => {
      setFormError(
        error instanceof Error ? error.message : 'Failed to save history',
      )
    },
    [setFormError],
  )

  const requestHistoryPersist = useHistoryPersistence({
    items: history,
    ready: historyPersistReady,
    onStored: handleHistoryStored,
    onRecovered: handleHistoryRecovered,
    onError: handleHistoryPersistError,
  })

  useEffect(() => {
    historyRef.current = history
  }, [history])

  const handleHistoryMigrationError = useCallback(
    (error: unknown) => {
      setFormError(
        error instanceof Error
          ? `Failed to migrate history: ${error.message}`
          : 'Failed to migrate history',
      )
    },
    [setFormError],
  )
  const handleHistoryReady = useCallback(() => {
    setHistoryPersistReady(true)
  }, [])

  useHistoryMigration({
    isSuccess: historyQuery.isSuccess,
    data: historyQuery.data,
    setHistory,
    queryClient,
    onReady: handleHistoryReady,
    onError: handleHistoryMigrationError,
  })

  useEffect(() => {
    if (!historyPersistReady) return
    let cancelled = false
    const syncFromServer = () => {
      void (async () => {
        try {
          const response = await fetchHistory()
          if (cancelled) return
          setHistory((previous) =>
            mergeServerHistory(previous, response.data.items),
          )
          queryClient.setQueryData(['history'], response.data.items)
        } catch {
          // Background gallery sync; keep local state on failure.
        }
      })()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncFromServer()
    }
    window.addEventListener('focus', syncFromServer)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.removeEventListener('focus', syncFromServer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [historyPersistReady, queryClient])

  // 開いたまま期限切れになった進行中を unknown に落とす
  useEffect(() => {
    const demoteStalePending = () => {
      const now = Date.now()
      let changed = false
      const next = historyRef.current.map((item) => {
        if (
          (item.state === 'waiting' ||
            item.state === 'queuing' ||
            item.state === 'generating') &&
          now - item.createdAt >= PENDING_STALE_MS
        ) {
          changed = true
          return { ...item, state: 'unknown' as const }
        }
        return item
      })
      if (!changed) return
      setHistory(next)
      requestHistoryPersist('immediate')
    }
    demoteStalePending()
    const id = window.setInterval(demoteStalePending, 60_000)
    return () => window.clearInterval(id)
  }, [requestHistoryPersist])

  // ピン留めの楽観的更新（即時 UI 反映、サーバー保存失敗時は自動ロールバック）
  const [optimisticHistory, applyOptimisticPin] = useOptimistic(
    history,
    (current: HistoryItem[], taskId: string) =>
      togglePinInList(current, taskId).next,
  )

  function togglePin(taskId: string) {
    const result = togglePinInList(history, taskId)
    if (result.rejected === 'pin-limit') {
      setFormError(`You can pin up to ${MAX_PINNED} items`)
      return
    }
    startTransition(async () => {
      applyOptimisticPin(taskId)
      try {
        const response = await putHistory(capItems(result.next))
        setHistory(response.data.items)
        queryClient.setQueryData(['history'], response.data.items)
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : 'Failed to save history',
        )
      }
    })
  }

  function exportHistory() {
    const blob = new Blob([exportHistoryJson(history)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kie-studio-history-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function importHistory(raw: string) {
    void (async () => {
      try {
        const items = parseHistoryJson(raw)
        const res = await importHistoryApi(items)
        setHistory(res.data.items)
        queryClient.setQueryData(['history'], res.data.items)
        setFormNotice(`Imported ${res.data.items.length} history items`)
      } catch (e) {
        setFormError(
          e instanceof Error ? e.message : 'Failed to import history',
        )
      }
    })()
  }

  function updateHistoryItem(item: HistoryItem) {
    setHistory((previous) => upsertInList(previous, item))
    requestHistoryPersist('immediate')
  }

  function removeHistoryItem(taskId: string) {
    setHistory((prev) => removeFromList(prev, taskId))
    void (async () => {
      try {
        const response = await deleteHistoryItem(taskId)
        setHistory(response.data.items)
        queryClient.setQueryData(['history'], response.data.items)
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : 'Failed to delete history',
        )
        try {
          const recovered = await fetchHistory()
          setHistory(recovered.data.items)
          queryClient.setQueryData(['history'], recovered.data.items)
        } catch {
          // Keep the optimistic removal when recovery also fails.
        }
      }
    })()
  }

  function clearUnpinned() {
    setHistory((prev) => prev.filter((h) => h.pinned))
    void (async () => {
      try {
        const response = await clearUnpinnedHistory()
        setHistory(response.data.items)
        queryClient.setQueryData(['history'], response.data.items)
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : 'Failed to delete history',
        )
        try {
          const recovered = await fetchHistory()
          setHistory(recovered.data.items)
          queryClient.setQueryData(['history'], recovered.data.items)
        } catch {
          // Keep the optimistic clear when recovery also fails.
        }
      }
    })()
  }

  return {
    history: optimisticHistory,
    /**
     * false なら初回 hydrate・移行が未完了（空配列と区別して読込中を表示できる）。
     * 取得失敗時はスケルトンが残り続けないよう true 扱いにする。
     */
    historyReady: historyPersistReady || historyQuery.isError,
    setHistory,
    requestHistoryPersist,
    togglePin,
    exportHistory,
    importHistory,
    updateHistoryItem,
    removeHistoryItem,
    clearUnpinned,
  }
}
