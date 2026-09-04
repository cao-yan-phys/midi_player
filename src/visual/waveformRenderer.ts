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

interface PlotPoint {
  x: number
  y: number
}

const stabilizeSubpixelRuns = (points: PlotPoint[], tolerance: number) => {
  if (points.length < 2 || tolerance <= 0) {
    return points
  }

  const stabilized: PlotPoint[] = []
  let runStart = 0
  let runMin = points[0].y
  let runMax = points[0].y
  let runSum = points[0].y

  const flushRun = (end: number) => {
    const averageY = runSum / (end - runStart + 1)
    const first = points[runStart]
    const last = points[end]

    stabilized.push({ x: first.x, y: averageY })

    if (last.x !== first.x) {
      stabilized.push({ x: last.x, y: averageY })
    }
  }

  for (let index = 1; index < points.length; index += 1) {
    const nextMin = Math.min(runMin, points[index].y)
    const nextMax = Math.max(runMax, points[index].y)

    if (nextMax - nextMin > tolerance) {
      flushRun(index - 1)
      runStart = index
      runMin = points[index].y
      runMax = points[index].y
      runSum = points[index].y
      continue
    }

    runMin = nextMin
    runMax = nextMax
    runSum += points[index].y
  }

  flushRun(points.length - 1)
  return stabilized
}

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
    overviewProgress: progress,
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
  const visiblePixelSpan = Math.max(
    1,
    Math.abs(mapping.timeToX(endTime) - mapping.timeToX(startTime)),
  )
  const pixelRatio = Math.max(1, ctx.getTransform().a)
  const flowPointBudget = Math.max(90, Math.floor(mapping.pixelsPerSecond * 13))
  const overviewPointBudget = Math.max(
    flowPointBudget,
    Math.floor(visiblePixelSpan * pixelRatio * 2),
  )
  const pointBudget = Math.max(
    90,
    Math.floor(
      lerp(flowPointBudget, overviewPointBudget, mapping.overviewProgress),
    ),
  )
  const stride = Math.max(
    1,
    Math.ceil((endIndex - startIndex + 1) / pointBudget),
  )

  ctx.save()
  ctx.lineWidth = 1.35
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const buckets: Array<{
    centerIndex: number
    average: number
  }> = []

  for (
    let bucketStart = startIndex + 1;
    bucketStart <= endIndex;
    bucketStart += stride
  ) {
    const bucketEnd = Math.min(endIndex, bucketStart + stride - 1)
    let sum = 0

    for (let index = bucketStart; index <= bucketEnd; index += 1) {
      sum += values[index]
    }

    buckets.push({
      centerIndex: (bucketStart + bucketEnd) * 0.5,
      average: sum / (bucketEnd - bucketStart + 1),
    })
  }

  const points = [
    {
      x: mapping.timeToX((startIndex / lastSample) * duration),
      y: valueToY(values[startIndex]),
    },
    ...buckets.map((bucket) => ({
      x: mapping.timeToX((bucket.centerIndex / lastSample) * duration),
      y: valueToY(bucket.average),
    })),
    {
      x: mapping.timeToX((endIndex / lastSample) * duration),
      y: valueToY(values[endIndex]),
    },
  ]
  const displayPoints = stabilizeSubpixelRuns(
    points,
    mapping.overviewProgress * 0.85,
  )

  ctx.strokeStyle = withAlpha(color, 0.74)
  ctx.lineWidth = 1.35
  ctx.beginPath()
  ctx.moveTo(displayPoints[0].x, displayPoints[0].y)

  displayPoints.slice(1).forEach((point) => {
    ctx.lineTo(point.x, point.y)
  })
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
