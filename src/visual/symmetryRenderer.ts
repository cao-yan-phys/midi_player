import type { SymmetryOccurrence } from '../midi/symmetryAnalysis'
import type { MidiNote } from '../midi/noteTypes'
import type { CoordinateSystem } from './coordinate'

interface RenderSymmetryOptions {
  ctx: CanvasRenderingContext2D
  occurrences: SymmetryOccurrence[]
  notes: MidiNote[]
  currentTime: number
  coordinates: CoordinateSystem
  visibleTracks: ReadonlySet<number>
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const strokeTrace = (
  ctx: CanvasRenderingContext2D,
  notes: MidiNote[],
  writtenEnd: number,
  coordinates: CoordinateSystem,
  color: string,
  dash: number[],
  alpha: number,
) => {
  let previous: MidiNote | null = null
  let hasPath = false

  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = clamp(alpha, 0, 1)
  ctx.lineWidth = 7
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
    const onsetGap = previous
      ? note.start - previous.start
      : Number.POSITIVE_INFINITY
    const gap = previous ? note.start - previous.end : Number.POSITIVE_INFINITY

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

export const renderSymmetryTrace = ({
  ctx,
  occurrences,
  notes,
  currentTime,
  coordinates,
  visibleTracks,
}: RenderSymmetryOptions) => {
  const noteById = new Map(notes.map((note) => [note.id, note]))

  occurrences.forEach((occurrence) => {
    if (!visibleTracks.has(occurrence.track) || currentTime < occurrence.start) {
      return
    }

    const writtenEnd = Math.min(currentTime, occurrence.end)
    const occurrenceNotes = occurrence.noteIds
      .map((id) => noteById.get(id))
      .filter((note): note is MidiNote => Boolean(note))
      .filter((note) => note.start <= writtenEnd)

    if (occurrenceNotes.length === 0) {
      return
    }

    const alpha = occurrenceNotes.reduce(
      (sum, note) =>
        sum + coordinates.alphaForTime(Math.min(note.end, writtenEnd)),
      0,
    ) / occurrenceNotes.length

    if (alpha <= 0.02) {
      return
    }

    strokeTrace(
      ctx,
      occurrenceNotes,
      writtenEnd,
      coordinates,
      occurrence.kind === 'axis' ? '#d0a11c' : '#8c1d2c',
      [],
      Math.max(alpha, 0.45) * (occurrence.kind === 'axis' ? 0.32 : 0.58),
    )
  })
}
