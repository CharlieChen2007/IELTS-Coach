import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** Coalesce layout reports without imposing a fixed-height scroll container. */
export function useFrameHeight(key: string, min: number, fallback: number, _holdDownMs = 800, _immediateFirst = false) {
  const cacheKey = key + ':' + Math.round(window.innerWidth / 80)
  const [height, setHeight] = useState(() => readHeight(cacheKey, fallback))
  const queued = useRef({ frame: 0, value: 0 })
  const current = useRef({cacheKey,min})
  current.current = {cacheKey,min}
  // Keep the last real height while a route or width changes. Resetting to an
  // estimate here races the child's report and can leave a short iframe behind.
  const push = useCallback((next: number) => {
    if (!Number.isFinite(next) || next < 1) return
    queued.current.value = Math.max(current.current.min, Math.min(60000, Math.ceil(next)))
    if (queued.current.frame) return
    queued.current.frame = requestAnimationFrame(() => {
      const value = queued.current.value
      queued.current.frame = 0
      setHeight(previous => {
        // Even a 1 px shortfall creates a second document scrollbar in classic mode.
        if (value === previous) return previous
        try { sessionStorage.setItem('ielts-frame-height:' + current.current.cacheKey, String(value)) } catch { /* Optional cache. */ }
        return value
      })
    })
  }, [])
  useLayoutEffect(() => () => cancelAnimationFrame(queued.current.frame), [])
  return [height, push] as const
}
function readHeight(key: string, fallback: number): number {
  try {
    const value = Number(sessionStorage.getItem('ielts-frame-height:' + key))
    if (Number.isFinite(value) && value >= 200 && value <= 60000) return value
  } catch { /* Optional cache. */ }
  return fallback
}
