import { useEffect, useRef, useState } from 'react'

const JITTER_INTERVAL = 500 // ms
export const METER_TWEEN_MS = 350

interface LiveMeterOptions {
  jitter: number
  min: number
  max: number
  paused: boolean
}

export type MeterTrend = 'up' | 'down' | 'steady'

/**
 * Display-only target for a dashboard meter. Every JITTER_INTERVAL it picks a
 * value near the latest telemetry reading, so meters feel live without changing
 * the telemetry the rest of the app uses. The meter eases to each target with
 * CSS transitions (and useTweenedText for the number), keeping React renders to
 * one per tick. The trend reports which way the current sweep moves and returns
 * to 'steady' once it lands. Pausing freezes the target; resuming continues.
 */
export function useLiveMeter(base: number, { jitter, min, max, paused }: LiveMeterOptions): [number, MeterTrend] {
  const [target, setTarget] = useState(base)
  const [trend, setTrend] = useState<MeterTrend>('steady')
  const targetRef = useRef(base)
  const baseRef = useRef(base)

  useEffect(() => {
    baseRef.current = base
  }, [base])

  useEffect(() => {
    if (paused) return

    let settle: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const next = Math.min(max, Math.max(min, baseRef.current + (Math.random() * 2 - 1) * jitter))
      const delta = next - targetRef.current
      targetRef.current = next
      setTarget(next)
      // Ignore moves too small to see so the colour doesn't flicker on noise
      setTrend(Math.abs(delta) < jitter * 0.1 ? 'steady' : delta > 0 ? 'up' : 'down')
      clearTimeout(settle)
      settle = setTimeout(() => setTrend('steady'), METER_TWEEN_MS)
    }

    tick()
    const id = setInterval(tick, JITTER_INTERVAL)
    return () => {
      clearInterval(id)
      clearTimeout(settle)
      setTrend('steady')
    }
  }, [paused, jitter, min, max])

  return [target, trend]
}

/**
 * Counts an element's text toward `value` (ease-out cubic) by writing to the
 * DOM directly, so the per-frame animation never re-renders React.
 */
export function useTweenedText<T extends HTMLElement>(value: number, decimals: number) {
  const ref = useRef<T>(null)
  const shownRef = useRef(value)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const from = shownRef.current
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduceMotion || from === value) {
      shownRef.current = value
      el.textContent = value.toFixed(decimals)
      return
    }
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / METER_TWEEN_MS)
      shownRef.current = from + (value - from) * (1 - Math.pow(1 - t, 3))
      el.textContent = shownRef.current.toFixed(decimals)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, decimals])

  return ref
}
