import { useEffect, useRef, useState } from 'react'

export const SPEED_MIN = 30
export const SPEED_MAX = 180

const TICK_MS = 500
const TARGET_HOLD_TICKS = [6, 14] // a new cruise target every 3–7 s
const MAX_STEP = 6 // km/h per tick, so speed ramps instead of jumping

/**
 * Standalone simulated vehicle speed (km/h) for ECO mode. It is not part of the
 * shared telemetry: it cruises toward a randomly chosen target, picking a new
 * one every few seconds so every speed zone shows up, with a little noise on
 * top. Pausing freezes it; resuming continues from the same speed.
 */
export function useSimulatedSpeed(paused: boolean): number {
  const [speed, setSpeed] = useState(72)
  const targetRef = useRef(72)
  const holdRef = useRef(0)

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      if (holdRef.current <= 0) {
        targetRef.current = SPEED_MIN + 5 + Math.random() * (SPEED_MAX - SPEED_MIN - 10)
        const [lo, hi] = TARGET_HOLD_TICKS
        holdRef.current = lo + Math.floor(Math.random() * (hi - lo + 1))
      }
      holdRef.current -= 1
      setSpeed((prev) => {
        const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, (targetRef.current - prev) * 0.35))
        const next = prev + step + (Math.random() - 0.5) * 2
        return Math.min(SPEED_MAX, Math.max(SPEED_MIN, next))
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [paused])

  return speed
}
