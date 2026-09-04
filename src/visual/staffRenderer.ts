import type { CoordinateSystem } from './coordinate'

interface RenderGrandStaffOptions {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  coordinates: CoordinateSystem
  showChromaticLines: boolean
  showStaffLines: boolean
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

export const renderGrandStaff = ({
  ctx,
  width,
  height,
  coordinates,
  showChromaticLines,
  showStaffLines,
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

  ctx.restore()
}
