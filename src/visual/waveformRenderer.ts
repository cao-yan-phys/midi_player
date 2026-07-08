import type { GwWaveform } from '../midi/noteTypes'
import { getWriteHeadX, roleColor } from './coordinate'

interface RenderWaveformOptions {
  ctx: CanvasRenderingContext2D
  width: number
  top: number
  height: number
  waveform: GwWaveform
  duration: number
  currentTime: number
  overviewProgress?: number
  visibleTracks: ReadonlySet<number>
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const lerp = (from: number, to: number, progress: number) =>
  from + (to - from) * progress

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3

const withAlpha = (hex: string, alpha: number) => {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

const getFlowPixelsPerSecond = (width: number) => clamp(width / 13.5, 44, 92)

const createTimeMapping = (
  width: number,
  duration: number,
  currentTime: number,
  overviewProgress: number,
) => {
  const safeDuration = Math.max(duration, 0.01)
  const progress = easeOutCubic(clamp(overviewProgress, 0, 1))
  const flowPixelsPerSecond = getFlowPixelsPerSecond(width)
  const flowWriteHeadX = getWriteHeadX(width)
  const flowVisibleStart = currentTime - flowWriteHeadX / flowPixelsPerSecond - 0.8
  const flowVisibleEnd =
    currentTime + (width - flowWriteHeadX) / flowPixelsPerSecond
  const overviewPaddingX = clamp(width * 0.065, 28, 64)
  const overviewInnerWidth = Math.max(1, width - overviewPaddingX * 2)
  const overviewPixelsPerSecond = overviewInnerWidth / safeDuration

  return {
    visibleStart: lerp(flowVisibleStart, 0, progress),
    visibleEnd: lerp(flowVisibleEnd, safeDuration, progress),
    timeToX: (time: number) =>
      lerp(
        flowWriteHeadX + (time - currentTime) * flowPixelsPerSecond,
        overviewPaddingX + clamp(time / safeDuration, 0, 1) * overviewInnerWidth,
        progress,
      ),
    alphaForTime: (time: number) => {
      const flowX = flowWriteHeadX + (time - currentTime) * flowPixelsPerSecond
      const flowAlpha =
        clamp((flowX + 120) / 160, 0, 1) *
        clamp((width - flowX + 80) / 120, 0, 1)

      return lerp(flowAlpha, 1, progress)
    },
    pixelsPerSecond: lerp(
      flowPixelsPerSecond,
      overviewPixelsPerSecond,
      progress,
    ),
  }
}

const drawSeries = (
  ctx: CanvasRenderingContext2D,
  values: number[],
  color: string,
  plotTop: number,
  plotHeight: number,
  duration: number,
  currentTime: number,
  sampleCount: number,
  valueMin: number,
  valueMax: number,
  mapping: ReturnType<typeof createTimeMapping>,
) => {
  if (values.length < 2 || sampleCount < 2) {
    return
  }

  const endTime = clamp(Math.min(mapping.visibleEnd, duration), 0, duration)
  const startTime = clamp(mapping.visibleStart, 0, endTime)

  if (endTime <= startTime) {
    return
  }

  const valueSpan = Math.max(valueMax - valueMin, Number.EPSILON)
  const valueToY = (value: number) =>
    plotTop + ((valueMax - value) / valueSpan) * plotHeight
  const lastSample = sampleCount - 1
  const startIndex = clamp(
    Math.floor((startTime / duration) * lastSample),
    0,
    lastSample,
  )
  const endIndex = clamp(
    Math.ceil((endTime / duration) * lastSample),
    startIndex + 1,
    lastSample,
  )
  const maxPoints = Math.max(90, Math.floor(mapping.pixelsPerSecond * 13))
  const stride = Math.max(1, Math.floor((endIndex - startIndex + 1) / maxPoints))

  ctx.save()
  ctx.lineWidth = 1.35
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = withAlpha(color, 0.74)
  ctx.beginPath()

  let hasPoint = false
  let lastDrawnIndex = -1

  for (let index = startIndex; index <= endIndex; index += stride) {
    const time = (index / lastSample) * duration
    const x = mapping.timeToX(time)
    const y = valueToY(values[index])

    if (!hasPoint) {
      ctx.moveTo(x, y)
      hasPoint = true
      lastDrawnIndex = index
      continue
    }

    ctx.lineTo(x, y)
    lastDrawnIndex = index
  }

  if (lastDrawnIndex !== endIndex) {
    const time = (endIndex / lastSample) * duration
    ctx.lineTo(mapping.timeToX(time), valueToY(values[endIndex]))
  }

  ctx.stroke()

  const cursorTime = clamp(currentTime, startTime, endTime)
  const currentIndex = clamp(
    Math.round((cursorTime / duration) * lastSample),
    0,
    lastSample,
  )
  const currentX = mapping.timeToX(cursorTime)
  const currentY = valueToY(values[currentIndex])
  const currentAlpha = mapping.alphaForTime(cursorTime)

  ctx.fillStyle = withAlpha(color, 0.7 * currentAlpha)
  ctx.beginPath()
  ctx.ellipse(currentX, currentY, 2.5, 2.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const renderGwWaveform = ({
  ctx,
  width,
  top,
  height,
  waveform,
  duration,
  currentTime,
  overviewProgress = 0,
  visibleTracks,
}: RenderWaveformOptions) => {
  const panelTop = top + 6
  const panelBottom = top + height - 8
  const panelHeight = Math.max(1, panelBottom - panelTop)
  const valueMin = waveform.valueMin
  const valueMax = waveform.valueMax
  const valueSpan = Math.max(valueMax - valueMin, Number.EPSILON)
  const valueToY = (value: number) =>
    panelTop + ((valueMax - value) / valueSpan) * panelHeight
  const mapping = createTimeMapping(
    width,
    duration,
    currentTime,
    overviewProgress,
  )

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, top, width, height)
  ctx.clip()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.fillRect(0, top, width, height)

  ctx.strokeStyle = 'rgba(68, 62, 53, 0.14)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, top + 0.5)
  ctx.lineTo(width, top + 0.5)
  ctx.stroke()

  if (valueMin < 0 && valueMax > 0) {
    const zeroY = valueToY(0)
    ctx.strokeStyle = 'rgba(68, 62, 53, 0.12)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(0, zeroY)
    ctx.lineTo(width, zeroY)
    ctx.stroke()
  }

  waveform.series.forEach((series) => {
    if (!visibleTracks.has(series.track)) {
      return
    }

    drawSeries(
      ctx,
      series.values,
      roleColor(series.role, series.track),
      panelTop,
      panelHeight,
      duration,
      currentTime,
      waveform.sampleCount,
      valueMin,
      valueMax,
      mapping,
    )
  })

  ctx.restore()
}
