import type { CoordinateSystem } from './coordinate'
import { bassStaffPitches, trebleStaffPitches } from './staffRenderer'

interface RenderClefRailOptions {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  inkHeight: number
  coordinates: CoordinateSystem
  showStaffLines: boolean
}

interface ClefDefinition {
  glyph: string
  anchorPitch: number
  staffPitches: readonly number[]
}

const trebleClef: ClefDefinition = {
  glyph: '\uE050',
  anchorPitch: 67,
  staffPitches: trebleStaffPitches,
}

const bassClef: ClefDefinition = {
  glyph: '\uE062',
  anchorPitch: 53,
  staffPitches: bassStaffPitches,
}

const averageStaffSpace = (
  pitches: readonly number[],
  coordinates: CoordinateSystem,
) => {
  const distances = pitches.slice(1).map((pitch, index) =>
    Math.abs(
      coordinates.pitchToY(pitch) -
        coordinates.pitchToY(pitches[index] ?? pitch),
    ),
  )

  return (
    distances.reduce((sum, distance) => sum + distance, 0) /
    Math.max(distances.length, 1)
  )
}

const isVisibleStaff = (
  pitches: readonly number[],
  coordinates: CoordinateSystem,
  height: number,
) =>
  pitches.every((pitch) => {
    const y = coordinates.pitchToY(pitch)
    return y >= 8 && y <= height - 8
  })

const drawClef = (
  ctx: CanvasRenderingContext2D,
  width: number,
  inkHeight: number,
  coordinates: CoordinateSystem,
  definition: ClefDefinition,
) => {
  if (!isVisibleStaff(definition.staffPitches, coordinates, inkHeight)) {
    return
  }

  const staffSpace = averageStaffSpace(definition.staffPitches, coordinates)

  if (staffSpace < 7) {
    return
  }

  ctx.font = `${Math.min(Math.max(staffSpace * 4, 48), 190)}px Bravura`
  const leftEdge = Math.min(Math.max(width * 0.14, 10), 18)
  const metrics = ctx.measureText(definition.glyph)
  ctx.fillText(
    definition.glyph,
    leftEdge + metrics.actualBoundingBoxLeft,
    coordinates.pitchToY(definition.anchorPitch),
  )
}

export const renderClefRail = ({
  ctx,
  width,
  height,
  inkHeight,
  coordinates,
  showStaffLines,
}: RenderClefRailOptions) => {
  ctx.clearRect(0, 0, width, height)

  if (!showStaffLines || width <= 0 || inkHeight <= 0) {
    return
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, inkHeight)
  ctx.clip()
  ctx.fillStyle = '#171411'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  drawClef(ctx, width, inkHeight, coordinates, trebleClef)
  drawClef(ctx, width, inkHeight, coordinates, bassClef)
  ctx.restore()
}
