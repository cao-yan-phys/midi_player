import type { MotifGroup, MotifOccurrence } from '../midi/motifAnalysis'
import type { MidiNote } from '../midi/noteTypes'
import type { CoordinateSystem } from './coordinate'

interface RenderMotifTraceOptions {
  ctx: CanvasRenderingContext2D
  groups: MotifGroup[]
  notes: MidiNote[]
  currentTime: number
  coordinates: CoordinateSystem
  visibleTracks: ReadonlySet<number>
}

const motifPalette = ['#255a9a', '#b13b2b', '#6d4b9a', '#237057']

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const withAlpha = (hex: string, alpha: number) => {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`
}

const traceStyleForOccurrence = (
  occurrence: MotifOccurrence,
  familyColor: string,
) => {
  let color = familyColor
  let dash: number[] = []
  let lineWidth = 1.7

  if (occurrence.form === 'inversion') {
    color = '#b1312a'
    dash = [9, 3.5]
    lineWidth = 2.35
  }

  if (occurrence.rhythm === 'augmentation') {
    color = occurrence.form === 'inversion' ? '#9a3a49' : '#69478e'
    dash = [1.5, 4.5]
    lineWidth = 2.55
  } else if (occurrence.rhythm === 'diminution') {
    color = occurrence.form === 'inversion' ? '#944842' : '#176e60'
    dash = [10, 3, 2, 3]
    lineWidth = 2
  } else if (occurrence.form === 'inversion') {
    dash = [9, 3.5]
  }

  if (occurrence.isStretto) {
    color = occurrence.form === 'inversion' ? '#b1312a' : '#a15e16'
    dash = dash.length > 0 ? [...dash, 2, 2] : [7, 2, 2, 2]
    lineWidth += 0.65
  }

  return { color, dash, lineWidth }
}

const drawTrace = (
  ctx: CanvasRenderingContext2D,
  notes: MidiNote[],
  writtenEnd: number,
  coordinates: CoordinateSystem,
  color: string,
  dash: number[],
  alpha: number,
  lineWidth: number,
) => {
  if (notes.length === 0) {
    return
  }

  let previous: MidiNote | null = null
  let hasPath = false

  ctx.save()
  ctx.strokeStyle = withAlpha(color, alpha)
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dash)
  ctx.beginPath()

  notes.forEach((note) => {
    const noteEnd = Math.min(note.end, writtenEnd)

    if (noteEnd < note.start) {
      return
    }

    const startX = coordinates.timeToX(note.start)
    const endX = coordinates.timeToX(noteEnd)
    const y = coordinates.pitchToY(note.pitch, note.role)
    const gap = previous ? note.start - previous.end : Number.POSITIVE_INFINITY
    const onsetGap = previous
      ? note.start - previous.start
      : Number.POSITIVE_INFINITY

    if (!previous || onsetGap <= 0.025 || gap > 0.45) {
      ctx.moveTo(startX, y)
    } else {
      const previousX = coordinates.timeToX(Math.min(previous.end, writtenEnd))
      const previousY = coordinates.pitchToY(previous.pitch, previous.role)
      const middleX = (previousX + startX) * 0.5
      const middleY = (previousY + y) * 0.5

      ctx.quadraticCurveTo(previousX, previousY, middleX, middleY)
      ctx.quadraticCurveTo(startX, y, startX, y)
    }

    ctx.lineTo(endX, y)
    hasPath = true
    previous = note
  })

  if (hasPath) {
    ctx.stroke()
  }

  ctx.restore()
}

const renderOccurrence = (
  ctx: CanvasRenderingContext2D,
  occurrence: MotifOccurrence,
  noteById: ReadonlyMap<string, MidiNote>,
  currentTime: number,
  coordinates: CoordinateSystem,
  color: string,
  dash: number[],
  lineWidth: number,
) => {
  if (currentTime < occurrence.start) {
    return
  }

  const writtenEnd = Math.min(currentTime, occurrence.end)
  const notes = occurrence.noteIds
    .map((id) => noteById.get(id))
    .filter((note): note is MidiNote => Boolean(note))
    .filter((note) => note.start <= writtenEnd)

  if (notes.length === 0) {
    return
  }

  const alpha =
    notes.reduce(
      (sum, note) => sum + coordinates.alphaForTime(Math.min(note.end, writtenEnd)),
      0,
    ) / notes.length

  if (alpha <= 0.02) {
    return
  }

  drawTrace(
    ctx,
    notes,
    writtenEnd,
    coordinates,
    color,
    dash,
    Math.max(alpha, 0.5) * 0.92,
    lineWidth,
  )

}

export const renderMotifTrace = ({
  ctx,
  groups,
  notes,
  currentTime,
  coordinates,
  visibleTracks,
}: RenderMotifTraceOptions) => {
  const noteById = new Map(notes.map((note) => [note.id, note]))

  groups.forEach((group) => {
    const color = motifPalette[group.styleIndex % motifPalette.length] ?? motifPalette[0]

    group.occurrences.forEach((occurrence) => {
      if (!visibleTracks.has(occurrence.track)) {
        return
      }

      const style = traceStyleForOccurrence(occurrence, color)

      renderOccurrence(
        ctx,
        occurrence,
        noteById,
        currentTime,
        coordinates,
        style.color,
        style.dash,
        style.lineWidth,
      )
    })
  })
}
