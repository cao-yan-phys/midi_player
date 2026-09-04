import type { MidiNote } from './noteTypes'

export type SymmetryKind = 'axis' | 'center'

export interface SymmetryOccurrence {
  id: string
  kind: SymmetryKind
  track: number
  lineId: string
  noteIds: string[]
  start: number
  end: number
}

export interface SymmetryGroups {
  axis: SymmetryOccurrence[]
  center: SymmetryOccurrence[]
}

interface MelodicLine {
  id: string
  track: number
  notes: MidiNote[]
}

interface RangeCandidate {
  startIndex: number
  endIndex: number
}

const MIN_SYMMETRY_NOTES = 5
const MAX_SYMMETRY_NOTES = 64
const ONSET_GROUP_TOLERANCE = 0.012
const LINE_OVERLAP_TOLERANCE = 0.035

const median = (values: number[]) => {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? sorted[middle] ?? 0
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) * 0.5
}

const groupOnsets = (notes: MidiNote[]) => {
  const groups: MidiNote[][] = []

  notes.forEach((note) => {
    const previous = groups.at(-1)
    const previousStart = previous?.[0]?.start

    if (
      previous &&
      previousStart !== undefined &&
      Math.abs(note.start - previousStart) <= ONSET_GROUP_TOLERANCE
    ) {
      previous.push(note)
      return
    }

    groups.push([note])
  })

  return groups
}

const splitTrackIntoLines = (track: number, notes: MidiNote[]) => {
  const lines: MidiNote[][] = []
  const sorted = [...notes].sort(
    (left, right) =>
      left.start - right.start || left.pitch - right.pitch || left.end - right.end,
  )

  groupOnsets(sorted).forEach((onsetNotes) => {
    const usedLines = new Set<number>()

    onsetNotes
      .sort((left, right) =>
        left.pitch - right.pitch || left.duration - right.duration,
      )
      .forEach((note) => {
        let bestLineIndex = -1
        let bestScore = Number.POSITIVE_INFINITY

        lines.forEach((line, index) => {
          if (usedLines.has(index)) {
            return
          }

          const previous = line.at(-1)

          if (!previous || note.start <= previous.start + ONSET_GROUP_TOLERANCE) {
            return
          }

          const overlap = previous.end - note.start

          if (overlap > LINE_OVERLAP_TOLERANCE) {
            return
          }

          const gap = Math.max(0, note.start - previous.end)
          const pitchDistance = Math.abs(note.pitch - previous.pitch)
          const score = pitchDistance * 0.76 + Math.min(gap, 4) * 0.24

          if (score < bestScore) {
            bestScore = score
            bestLineIndex = index
          }
        })

        if (bestLineIndex === -1) {
          lines.push([note])
          usedLines.add(lines.length - 1)
          return
        }

        lines[bestLineIndex]?.push(note)
        usedLines.add(bestLineIndex)
      })
  })

  return lines
    .filter((line) => line.length >= MIN_SYMMETRY_NOTES)
    .map<MelodicLine>((line, index) => ({
      id: `${track}:${index}`,
      track,
      notes: line,
    }))
}

const splitAtLongRests = (line: MelodicLine) => {
  const onsetGaps = line.notes
    .slice(1)
    .map((note, index) => note.start - (line.notes[index]?.start ?? note.start))
    .filter((gap) => gap > 0)
  const maximumGap = Math.max(1.2, median(onsetGaps) * 4.5)
  const segments: MidiNote[][] = []
  let segment: MidiNote[] = []

  line.notes.forEach((note, index) => {
    const previous = line.notes[index - 1]

    if (previous && note.start - previous.start > maximumGap) {
      if (segment.length >= MIN_SYMMETRY_NOTES) {
        segments.push(segment)
      }
      segment = []
    }

    segment.push(note)
  })

  if (segment.length >= MIN_SYMMETRY_NOTES) {
    segments.push(segment)
  }

  return segments.map<MelodicLine>((notes, index) => ({
    id: `${line.id}:${index}`,
    track: line.track,
    notes,
  }))
}

const buildMelodicLines = (notes: MidiNote[]) => {
  const byTrack = new Map<number, MidiNote[]>()

  notes.forEach((note) => {
    const trackNotes = byTrack.get(note.track)

    if (trackNotes) {
      trackNotes.push(note)
      return
    }

    byTrack.set(note.track, [note])
  })

  return [...byTrack.entries()].flatMap(([track, trackNotes]) =>
    splitTrackIntoLines(track, trackNotes).flatMap(splitAtLongRests),
  )
}

const hasPitchVariety = (notes: MidiNote[]) =>
  new Set(notes.map((note) => note.pitch)).size >= 3

const rangeKey = ({ startIndex, endIndex }: RangeCandidate) =>
  `${startIndex}:${endIndex}`

const retainMaximalRanges = (candidates: RangeCandidate[]) => {
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [
    rangeKey(candidate),
    candidate,
  ])).values()]
    .sort(
      (left, right) =>
        right.endIndex - right.startIndex - (left.endIndex - left.startIndex) ||
        left.startIndex - right.startIndex,
    )
  const maximal: RangeCandidate[] = []

  uniqueCandidates.forEach((candidate) => {
    const isContained = maximal.some(
      (range) =>
        range.startIndex <= candidate.startIndex &&
        range.endIndex >= candidate.endIndex,
    )

    if (!isContained) {
      maximal.push(candidate)
    }
  })

  return maximal.sort(
    (left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex,
  )
}

const findAxisRanges = (notes: MidiNote[]) => {
  const candidates: RangeCandidate[] = []

  for (let center = 0; center < notes.length; center += 1) {
    let left = center
    let right = center

    while (
      left > 0 &&
      right < notes.length - 1 &&
      right - left + 3 <= MAX_SYMMETRY_NOTES &&
      notes[left - 1]?.pitch === notes[right + 1]?.pitch
    ) {
      left -= 1
      right += 1
    }

    if (right - left + 1 >= MIN_SYMMETRY_NOTES) {
      candidates.push({ startIndex: left, endIndex: right })
    }
  }

  for (let center = 0; center < notes.length - 1; center += 1) {
    let left = center
    let right = center + 1

    while (
      notes[left]?.pitch === notes[right]?.pitch &&
      right - left + 1 <= MAX_SYMMETRY_NOTES
    ) {
      if (left === 0 || right === notes.length - 1) {
        break
      }

      if (notes[left - 1]?.pitch !== notes[right + 1]?.pitch) {
        break
      }

      left -= 1
      right += 1
    }

    if (right - left + 1 >= MIN_SYMMETRY_NOTES) {
      candidates.push({ startIndex: left, endIndex: right })
    }
  }

  return retainMaximalRanges(candidates).filter((range) =>
    hasPitchVariety(notes.slice(range.startIndex, range.endIndex + 1)),
  )
}

const findCenterRanges = (notes: MidiNote[]) => {
  const candidates: RangeCandidate[] = []

  for (let center = 0; center < notes.length; center += 1) {
    const reflectionSum = (notes[center]?.pitch ?? 0) * 2
    let left = center
    let right = center

    while (
      left > 0 &&
      right < notes.length - 1 &&
      right - left + 3 <= MAX_SYMMETRY_NOTES &&
      (notes[left - 1]?.pitch ?? 0) + (notes[right + 1]?.pitch ?? 0) ===
        reflectionSum
    ) {
      left -= 1
      right += 1
    }

    if (right - left + 1 >= MIN_SYMMETRY_NOTES) {
      candidates.push({ startIndex: left, endIndex: right })
    }
  }

  for (let center = 0; center < notes.length - 1; center += 1) {
    const reflectionSum =
      (notes[center]?.pitch ?? 0) + (notes[center + 1]?.pitch ?? 0)
    let left = center
    let right = center + 1

    while (
      (notes[left]?.pitch ?? 0) + (notes[right]?.pitch ?? 0) === reflectionSum &&
      right - left + 1 <= MAX_SYMMETRY_NOTES
    ) {
      if (left === 0 || right === notes.length - 1) {
        break
      }

      if (
        (notes[left - 1]?.pitch ?? 0) + (notes[right + 1]?.pitch ?? 0) !==
        reflectionSum
      ) {
        break
      }

      left -= 1
      right += 1
    }

    if (right - left + 1 >= MIN_SYMMETRY_NOTES) {
      candidates.push({ startIndex: left, endIndex: right })
    }
  }

  return retainMaximalRanges(candidates).filter((range) =>
    hasPitchVariety(notes.slice(range.startIndex, range.endIndex + 1)),
  )
}

const hasNoInterveningTrackEvents = (
  occurrenceNotes: MidiNote[],
  trackNotes: MidiNote[],
) => {
  const occurrenceIds = new Set(occurrenceNotes.map((note) => note.id))

  return occurrenceNotes.slice(1).every((note, index) => {
    const previous = occurrenceNotes[index]

    if (!previous) {
      return false
    }

    return !trackNotes.some(
      (candidate) =>
        !occurrenceIds.has(candidate.id) &&
        candidate.start > previous.start + ONSET_GROUP_TOLERANCE &&
        candidate.start < note.start - ONSET_GROUP_TOLERANCE,
    )
  })
}

const findOccurrencesForLine = (
  line: MelodicLine,
  kind: SymmetryKind,
  trackNotes: MidiNote[],
) => {
  const ranges = kind === 'axis'
    ? findAxisRanges(line.notes)
    : findCenterRanges(line.notes)

  return ranges.flatMap<SymmetryOccurrence>((range) => {
    const occurrenceNotes = line.notes.slice(range.startIndex, range.endIndex + 1)

    if (!hasNoInterveningTrackEvents(occurrenceNotes, trackNotes)) {
      return []
    }

    return [{
      id: `${kind}:${line.id}:${range.startIndex}:${range.endIndex}`,
      kind,
      track: line.track,
      lineId: line.id,
      noteIds: occurrenceNotes.map((note) => note.id),
      start: occurrenceNotes[0]?.start ?? 0,
      end: occurrenceNotes.at(-1)?.end ?? 0,
    }]
  })
}

const orderOccurrences = (occurrences: SymmetryOccurrence[]) =>
  occurrences.sort(
    (left, right) =>
      left.start - right.start || left.track - right.track || left.end - right.end,
  )

export const findSymmetryGroups = (notes: MidiNote[]): SymmetryGroups => {
  const lines = buildMelodicLines(notes)
  const notesByTrack = new Map<number, MidiNote[]>()

  notes.forEach((note) => {
    const trackNotes = notesByTrack.get(note.track)

    if (trackNotes) {
      trackNotes.push(note)
      return
    }

    notesByTrack.set(note.track, [note])
  })

  notesByTrack.forEach((trackNotes) =>
    trackNotes.sort((left, right) => left.start - right.start || left.pitch - right.pitch),
  )

  return {
    axis: orderOccurrences(
      lines.flatMap((line) =>
        findOccurrencesForLine(line, 'axis', notesByTrack.get(line.track) ?? []),
      ),
    ),
    center: orderOccurrences(
      lines.flatMap((line) =>
        findOccurrencesForLine(line, 'center', notesByTrack.get(line.track) ?? []),
      ),
    ),
  }
}
