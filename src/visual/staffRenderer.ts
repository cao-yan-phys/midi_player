import type { CoordinateSystem } from './coordinate'

interface RenderGrandStaffOptions {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  coordinates: CoordinateSystem
  showChromaticLines: boolean
  showStaffLines: boolean
  highlightedPitches?: ReadonlySet<number>
}

export const trebleStaffPitches = [64, 67, 71, 74, 77]
export const bassStaffPitches = [43, 47, 50, 53, 57]

const drawStaffLines = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pitches: number[],
  coordinates: CoordinateSystem,
) => {
  pitches.forEach((pitch) => {
    const y = coordinates.pitchToY(pitch)

    if (y < 6 || y > height - 6) {
      return
    }

    ctx.beginPath()
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(width, Math.round(y) + 0.5)
    ctx.stroke()
  })
}

const getChromaticPitchLines = (coordinates: CoordinateSystem) => {
  const startPitch = Math.floor(coordinates.pitchRange.min) - 5
  const endPitch = Math.ceil(coordinates.pitchRange.max) + 5
  const pitches: number[] = []

  for (let pitch = startPitch; pitch <= endPitch; pitch += 1) {
    pitches.push(pitch)
  }

  return pitches
}

const drawHighlightedPitchLines = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  coordinates: CoordinateSystem,
  highlightedPitches: ReadonlySet<number>,
) => {
  const minimumVisiblePitch = Math.floor(coordinates.pitchRange.min) - 5
  const maximumVisiblePitch = Math.ceil(coordinates.pitchRange.max) + 5

  ctx.save()
  ctx.strokeStyle = 'rgba(224, 176, 47, 0.26)'
  ctx.lineWidth = 5
  ctx.shadowColor = 'rgba(209, 154, 21, 0.28)'
  ctx.shadowBlur = 10

  highlightedPitches.forEach((pitch) => {
    if (pitch < minimumVisiblePitch || pitch > maximumVisiblePitch) {
      return
    }

    const y = coordinates.pitchToY(pitch)

    if (y < 6 || y > height - 6) {
      return
    }

    ctx.beginPath()
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(width, Math.round(y) + 0.5)
    ctx.stroke()
  })

  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(178, 121, 5, 0.96)'
  ctx.lineWidth = 1.4

  highlightedPitches.forEach((pitch) => {
    if (pitch < minimumVisiblePitch || pitch > maximumVisiblePitch) {
      return
    }

    const y = coordinates.pitchToY(pitch)

    if (y < 6 || y > height - 6) {
      return
    }

    ctx.beginPath()
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(width, Math.round(y) + 0.5)
    ctx.stroke()
  })

  ctx.restore()
}

export const renderGrandStaff = ({
  ctx,
  width,
  height,
  coordinates,
  showChromaticLines,
  showStaffLines,
  highlightedPitches = new Set<number>(),
}: RenderGrandStaffOptions) => {
  ctx.save()
  if (showChromaticLines) {
    ctx.strokeStyle = 'rgba(44, 39, 32, 0.045)'
    ctx.lineWidth = 1
    drawStaffLines(
      ctx,
      width,
      height,
      getChromaticPitchLines(coordinates),
      coordinates,
    )
  }

  if (showStaffLines) {
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1
    drawStaffLines(ctx, width, height, trebleStaffPitches, coordinates)
    drawStaffLines(ctx, width, height, bassStaffPitches, coordinates)
  }

  if (highlightedPitches.size > 0) {
    drawHighlightedPitchLines(
      ctx,
      width,
      height,
      coordinates,
      highlightedPitches,
    )
  }

  ctx.restore()
}
