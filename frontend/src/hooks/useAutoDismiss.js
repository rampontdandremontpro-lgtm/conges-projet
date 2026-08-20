import { useEffect, useRef } from 'react'

export const DEFAULT_FEEDBACK_DISMISS_MS = 5000

export function useAutoDismiss(
  value,
  setValue,
  {
    delay = DEFAULT_FEEDBACK_DISMISS_MS,
    clearValue = null,
    enabled = true,
  } = {},
) {
  const setterRef = useRef(setValue)

  useEffect(() => {
    setterRef.current = setValue
  }, [setValue])

  useEffect(() => {
    if (!enabled || !value) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setterRef.current?.(clearValue)
    }, delay)

    return () => window.clearTimeout(timer)
  }, [clearValue, delay, enabled, value])
}
