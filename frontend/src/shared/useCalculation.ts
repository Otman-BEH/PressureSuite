import { useEffect, useState } from 'react'

export interface Calculation<T> {
  result: T | null
  error: string | null
  loading: boolean
}

/** Runs `run` shortly after `key` (a JSON string of the inputs) changes, cancelling the previous request. */
export function useCalculation<T>(key: string, run: (signal: AbortSignal) => Promise<T>, delayMs = 250): Calculation<T> {
  const [state, setState] = useState<Calculation<T>>({ result: null, error: null, loading: false })
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }))
      try {
        const result = await run(controller.signal)
        setState({ result, error: null, loading: false })
      } catch (e) {
        if (!controller.signal.aborted) setState((s) => ({ ...s, error: (e as Error).message, loading: false }))
      }
    }, delayMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // `run` is rebuilt every render; `key` captures everything it depends on.
  }, [key, delayMs])
  return state
}
