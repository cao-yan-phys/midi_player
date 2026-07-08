import { useEffect, useRef, useState } from 'react'
import type { ParsedMidi } from '../midi/noteTypes'
import { drawVisualizationFrame } from '../visual/drawFrame'

interface CanvasViewProps {
  midi: ParsedMidi | null
  currentTime: number
  isPlaying: boolean
  isOverview: boolean
  getCurrentTime: () => number
  visibleTracks: ReadonlySet<number>
}

interface CanvasSize {
  width: number
  height: number
}

const emptySize: CanvasSize = {
  width: 0,
  height: 0,
}

const OVERVIEW_TRANSITION_MS = 1800

export function CanvasView({
  midi,
  currentTime,
  isPlaying,
  isOverview,
  getCurrentTime,
  visibleTracks,
}: CanvasViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<CanvasSize>(emptySize)

  useEffect(() => {
    const frame = frameRef.current

    if (!frame) {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({
        width: Math.round(width),
        height: Math.round(height),
      })
    })

    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas || size.width <= 0 || size.height <= 0) {
      return
    }

    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * pixelRatio)
    canvas.height = Math.round(size.height * pixelRatio)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
  }, [size.height, size.width])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas || size.width <= 0 || size.height <= 0) {
      return
    }

    let frameId = 0
    const pixelRatio = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

    const draw = (time: number, overviewProgress = 0) => {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      drawVisualizationFrame({
        ctx,
        width: size.width,
        height: size.height,
        midi,
        currentTime: time,
        overviewProgress,
        visibleTracks,
        showEmptyState: true,
      })
    }

    if (isOverview) {
      const startedAt = performance.now()

      const animateOverview = (now: number) => {
        const progress = Math.min(
          Math.max((now - startedAt) / OVERVIEW_TRANSITION_MS, 0),
          1,
        )

        draw(currentTime, progress)

        if (progress < 1) {
          frameId = window.requestAnimationFrame(animateOverview)
        }
      }

      frameId = window.requestAnimationFrame(animateOverview)
      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }

    if (!isPlaying) {
      draw(currentTime)
      return
    }

    const animate = () => {
      draw(getCurrentTime())
      frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [
    currentTime,
    getCurrentTime,
    isOverview,
    isPlaying,
    midi,
    size.height,
    size.width,
    visibleTracks,
  ])

  return (
    <div className="canvas-frame" ref={frameRef}>
      <canvas ref={canvasRef} />
    </div>
  )
}
