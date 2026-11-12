import { useEffect, type RefObject } from 'react'

/** Register page content with the same observer used by embedded workspaces. */
export function useReveal(rootRef: RefObject<HTMLElement | null>, deps: unknown[] = [], _options: { immediateWithin?: number } = {}) {
  useEffect(() => {
    if (rootRef.current) document.dispatchEvent(new CustomEvent('coach:motion-enter', { detail: rootRef.current }))
    // The caller supplies the values that change the visible content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
