import type { MidiNote } from './noteTypes'

export type MotifForm = 'direct' | 'inversion'
export type MotifRhythm = 'regular' | 'augmentation' | 'diminution'

export interface MotifOccurrence {
  id: string
  track: number
  lineId: string
  noteIds: string[]
  start: number
  end: number
  form?: MotifForm
  rhythm?: MotifRhythm
  isVaried?: boolean
  isStretto?: boolean
}

export interface MotifGroup {
  id: string
  styleIndex: number
  noteCount: number
  confidence: number
  occurrences: MotifOccurrence[]
}

interface MelodicLine {
  id: string
  track: number
  notes: MidiNote[]
}

interface MotifWindow {
  id: number
  lineId: string
  track: number
  startIndex: number
  endIndex: number
  notes: MidiNote[]
  intervals: number[]
  onsetGaps: number[]
  normalizedRhythm: number[]
  key: string
}

interface MatchPair {
  left: number
  right: number
  score: number
}

interface LineRange {
  lineId: string
  track: number
  startIndex: number
  endIndex: number
}

interface ExtendedMatch {
  left: LineRange
  right: LineRange
  confidence: number
}

interface RangeNode extends LineRange {
  id: number
}

interface MotifCandidate {
  noteCount: number
  confidence: number
  entryOccurrences: number
  openingOccurrences: number
  earliestEntryStart: number
  occurrences: MotifOccurrence[]
}

const WINDOW_NOTE_COUNT = 6
const MAX_BUCKET_SIZE = 160
const MAX_MOTIF_GROUPS = 1
const MAX_OCCURRENCES_PER_GROUP = 48
const ONSET_GROUP_TOLERANCE = 0.012
const LINE_OVERLAP_TOLERANCE = 0.035
const MAX_EVENT_GAP_SECONDS = 3.6
const MIN_ENTRY_GAP_SECONDS = 0.8
const MAX_FIGURE_PATHS = 256
const MAX_FIGURE_INTERVAL_DISTANCE = 17
const MAX_FIGURE_RHYTHM_SPREAD = 3.25
const FUGUE_ONSET_TOLERANCE = 0.028
const FUGUE_MIN_NOTE_COUNT = 7
const FUGUE_MAX_NOTE_COUNT = 12
const FUGUE_EXPOSITION_ENTRIES = 4
const FUGUE_INITIAL_DISTANCE_LIMIT = 1
const FUGUE_BASE_DISTANCE_LIMIT = 1
const FUGUE_MAX_INTERVAL_DEVIATION = 2
const FUGUE_EXPOSITION_GAP_RATIO = 3.1
const FUGUE_ENTRY_SEPARATION = 0.72
const FUGUE_EXACT_OVERLAP_DISTANCE = 0.25
const SHORT_SUBJECT_VARIANT_MIN_NOTE_COUNT = 10
const SHORT_SUBJECT_VARIANT_MAX_INTERVAL_DEVIATION = 3
const SHORT_SUBJECT_VARIANT_DISTANCE_LIMIT = 1
const SHORT_SUBJECT_VARIANT_RHYTHM_SPREAD = 1.35
const TEMPO_FLEXIBLE_SUBJECT_MIN_NOTE_COUNT = 12
const TEMPO_FLEXIBLE_SUBJECT_MAX_INTERVAL_DEVIATION = 1
const TEMPO_FLEXIBLE_SUBJECT_DISTANCE_LIMIT = 0.2
const TEMPO_FLEXIBLE_SUBJECT_RHYTHM_SPREAD = 1.22
const POLYPHONIC_FUGUE_HEAD_NOTE_COUNT = 5
const POLYPHONIC_ENTRY_TOLERANCE = 0.55
const POLYPHONIC_MAX_INTERVAL_DEVIATION = 3

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const median = (values: number[]) => {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) * 0.5
}

const analysisTimeScale = (notes: MidiNote[]) => {
  const typicalDuration = median(
    notes
      .map((note) => note.duration)
      .filter((duration) => duration > 0),
  )

  return clamp(0.4 / Math.max(typicalDuration, 0.001), 0.2, 5)
}

const motifIntervals = (notes: MidiNote[]) =>
  notes.slice(1).map((note, index) =>
    note.pitch - (notes[index]?.pitch ?? note.pitch),
  )

const motifOnsetGaps = (notes: MidiNote[]) =>
  notes.slice(1).map(
    (note, index) => note.start - (notes[index]?.start ?? note.start),
  )

const averageIntervalDistance = (
  source: number[],
  target: number[],
  inverted: boolean,
) => {
  const count = Math.min(source.length, target.length)

  if (count === 0) {
    return 0
  }

  return source.slice(0, count).reduce((sum, interval, index) => {
    const targetInterval = target[index] ?? interval
    return sum + Math.abs(interval - (inverted ? -targetInterval : targetInterval))
  }, 0) / count
}

const shareMotifNote = (
  left: MotifOccurrence,
  right: MotifOccurrence,
) => {
  const noteIds = new Set(left.noteIds)
  return right.noteIds.some((id) => noteIds.has(id))
}

const classifyMotifOccurrences = (
  occurrences: MotifOccurrence[],
  noteById: ReadonlyMap<string, MidiNote>,
) => {
  const prototypeOccurrence = occurrences.at(0)
  const prototypeNotes = prototypeOccurrence?.noteIds
    .map((id) => noteById.get(id))
    .filter((note): note is MidiNote => note !== undefined) ?? []
  const prototypeIntervals = motifIntervals(prototypeNotes)
  const prototypeGaps = motifOnsetGaps(prototypeNotes)
  const prototypeSpan =
    (prototypeNotes.at(-1)?.start ?? 0) - (prototypeNotes[0]?.start ?? 0)

  return occurrences.map((occurrence) => {
    const occurrenceNotes = occurrence.noteIds
      .map((id) => noteById.get(id))
      .filter((note): note is MidiNote => note !== undefined)
    const intervals = motifIntervals(occurrenceNotes)
    const directDistance = averageIntervalDistance(
      intervals,
      prototypeIntervals,
      false,
    )
    const inversionDistance = averageIntervalDistance(
      intervals,
      prototypeIntervals,
      true,
    )
    const inferredForm: MotifForm =
      inversionDistance + 0.18 < directDistance ? 'inversion' : 'direct'
    const form = occurrence.form ?? inferredForm
    const formDistance =
      form === 'inversion' ? inversionDistance : directDistance
    const span =
      (occurrenceNotes.at(-1)?.start ?? 0) - (occurrenceNotes[0]?.start ?? 0)
    const timeScale =
      prototypeSpan > 0.001 ? span / prototypeSpan : 1
    const gaps = motifOnsetGaps(occurrenceNotes)
    const rhythmDistance = gaps.reduce(
      (sum, gap, index) => {
        const prototypeGap = prototypeGaps[index] ?? gap
        return sum + Math.abs(Math.log(gap / Math.max(prototypeGap * timeScale, 0.001)))
      },
      0,
    ) / Math.max(gaps.length, 1)
    const rhythm: MotifRhythm =
      rhythmDistance <= 0.24 && timeScale >= 1.42
        ? 'augmentation'
        : rhythmDistance <= 0.24 && timeScale <= 0.7
          ? 'diminution'
          : 'regular'
    const isStretto = occurrences.some(
      (other) =>
        other.id !== occurrence.id &&
        (other.lineId !== occurrence.lineId ||
          !shareMotifNote(occurrence, other)) &&
        other.start < occurrence.end - 0.08 &&
        other.end > occurrence.start + 0.08,
    )

    return {
      ...occurrence,
      form,
      rhythm,
      isVaried: occurrence.isVaried ?? formDistance > 0.75,
      isStretto,
    }
  })
}

const directionOf = (interval: number) =>
  interval > 0 ? 'u' : interval < 0 ? 'd' : 's'

const rhythmKey = (gaps: number[]) => {
  const scale = Math.max(median(gaps.filter((gap) => gap > 0)), 0.001)

  return gaps
    .map((gap) => clamp(Math.round((gap / scale) * 4), 1, 20))
    .join('.')
}

const intervalShapeKey = (intervals: number[]) =>
  intervals
    .map((interval) => {
      const size = Math.abs(interval)
      return size <= 2 ? 's' : 'l'
    })
    .join('')

const normalizedRhythm = (gaps: number[]) => {
  const scale = Math.max(median(gaps.filter((gap) => gap > 0)), 0.001)
  return gaps.map((gap) => gap / scale)
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

const splitTrackIntoLines = (
  track: number,
  notes: MidiNote[],
  highestFirst = false,
) => {
  const lines: MidiNote[][] = []
  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || a.pitch - b.pitch || a.end - b.end,
  )

  groupOnsets(sorted).forEach((onsetNotes) => {
    const usedLines = new Set<number>()

    onsetNotes
      .sort((a, b) =>
        highestFirst
          ? b.pitch - a.pitch || a.duration - b.duration
          : a.pitch - b.pitch || a.duration - b.duration,
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
    .filter((line) => line.length >= WINDOW_NOTE_COUNT)
    .map<MelodicLine>((line, index) => ({
      id: highestFirst ? `${track}:high:${index}` : `${track}:${index}`,
      track,
      notes: line,
    }))
}

const buildMelodicLines = (notes: MidiNote[], highestFirst = false) => {
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
    splitTrackIntoLines(track, trackNotes, highestFirst),
  )
}

const findEntryIndexes = (line: MelodicLine) => {
  const indexes = new Set<number>([0])
  const onsetGaps = line.notes
    .slice(1)
    .map((note, index) => note.start - (line.notes[index]?.start ?? note.start))
    .filter((gap) => gap > 0 && gap <= MAX_EVENT_GAP_SECONDS)
  const typicalGap = Math.max(median(onsetGaps), 0.001)
  const entryGap = Math.max(MIN_ENTRY_GAP_SECONDS, typicalGap * 3.2)

  line.notes.slice(1).forEach((note, index) => {
    const previous = line.notes[index]

    if (previous && note.start - previous.start >= entryGap) {
      indexes.add(index + 1)
    }
  })

  return indexes
}

const buildEntryIndexes = (lines: MelodicLine[]) =>
  new Map(lines.map((line) => [line.id, findEntryIndexes(line)]))

const buildWindows = (lines: MelodicLine[]) => {
  const windows: MotifWindow[] = []

  lines.forEach((line) => {
    for (
      let startIndex = 0;
      startIndex + WINDOW_NOTE_COUNT <= line.notes.length;
      startIndex += 1
    ) {
      const notes = line.notes.slice(startIndex, startIndex + WINDOW_NOTE_COUNT)
      const onsetGaps = notes.slice(1).map((note, index) =>
        Math.max(0, note.start - (notes[index]?.start ?? note.start)),
      )
      const span = (notes.at(-1)?.start ?? 0) - (notes[0]?.start ?? 0)

      if (
        span < 0.42 ||
        onsetGaps.some((gap) => gap <= 0 || gap > MAX_EVENT_GAP_SECONDS)
      ) {
        continue
      }

      const intervals = notes.slice(1).map((note, index) =>
        note.pitch - (notes[index]?.pitch ?? note.pitch),
      )
      const contour = intervals.map(directionOf).join('')
      const key = `${contour}|${intervalShapeKey(intervals)}|${rhythmKey(onsetGaps)}`

      windows.push({
        id: windows.length,
        lineId: line.id,
        track: line.track,
        startIndex,
        endIndex: startIndex + WINDOW_NOTE_COUNT - 1,
        notes,
        intervals,
        onsetGaps,
        normalizedRhythm: normalizedRhythm(onsetGaps),
        key,
      })
    }
  })

  return windows
}

const areOverlappingWindows = (left: MotifWindow, right: MotifWindow) =>
  left.lineId === right.lineId &&
  left.startIndex <= right.endIndex &&
  right.startIndex <= left.endIndex

const scoreWindowMatch = (left: MotifWindow, right: MotifWindow) => {
  if (areOverlappingWindows(left, right)) {
    return 0
  }

  let exactIntervals = 0
  let closeIntervals = 0
  let tonalIntervals = 0
  let matchingDirection = 0

  left.intervals.forEach((interval, index) => {
    const candidate = right.intervals[index] ?? 0
    const difference = Math.abs(interval - candidate)

    if (difference <= 0.35) {
      exactIntervals += 1
    }

    if (difference <= 1.25) {
      closeIntervals += 1
    }

    if (difference <= 2.25) {
      tonalIntervals += 1
    }

    if (directionOf(interval) === directionOf(candidate)) {
      matchingDirection += 1
    }
  })

  const intervalCount = Math.max(left.intervals.length, 1)
  const exactScore = exactIntervals / intervalCount
  const closeScore = closeIntervals / intervalCount
  const tonalScore = tonalIntervals / intervalCount
  const contourScore = matchingDirection / intervalCount

  if (closeScore < 0.6 || tonalScore < 0.8 || contourScore < 1) {
    return 0
  }

  const rhythmDeviation = left.normalizedRhythm.reduce(
    (sum, value, index) =>
      sum +
      Math.abs(
        Math.log(
          Math.max(value, 0.001) /
            Math.max(right.normalizedRhythm[index] ?? value, 0.001),
        ),
      ),
    0,
  ) / Math.max(left.normalizedRhythm.length, 1)
  const rhythmScore = clamp(1 - rhythmDeviation / 0.32, 0, 1)

  if (rhythmScore < 0.82) {
    return 0
  }

  return (
    exactScore * 0.65 +
    closeScore * 0.14 +
    tonalScore * 0.09 +
    rhythmScore * 0.12
  )
}

const createDisjointSet = (size: number) => {
  const parent = Array.from({ length: size }, (_, index) => index)
  const rank = Array.from({ length: size }, () => 0)

  const find = (index: number): number => {
    const root = parent[index]

    if (root === index || root === undefined) {
      return index
    }

    const nextRoot = find(root)
    parent[index] = nextRoot
    return nextRoot
  }

  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)

    if (leftRoot === rightRoot) {
      return
    }

    const leftRank = rank[leftRoot] ?? 0
    const rightRank = rank[rightRoot] ?? 0

    if (leftRank < rightRank) {
      parent[leftRoot] = rightRoot
      return
    }

    parent[rightRoot] = leftRoot

    if (leftRank === rightRank) {
      rank[leftRoot] = leftRank + 1
    }
  }

  return { find, union }
}

const stepMatchScore = (
  leftLine: MelodicLine,
  rightLine: MelodicLine,
  leftIndex: number,
  rightIndex: number,
  timeScale: number,
) => {
  const leftPrevious = leftLine.notes[leftIndex - 1]
  const left = leftLine.notes[leftIndex]
  const rightPrevious = rightLine.notes[rightIndex - 1]
  const right = rightLine.notes[rightIndex]

  if (!leftPrevious || !left || !rightPrevious || !right) {
    return 0
  }

  const leftGap = left.start - leftPrevious.start
  const rightGap = right.start - rightPrevious.start

  if (
    leftGap <= 0 ||
    rightGap <= 0 ||
    leftGap > MAX_EVENT_GAP_SECONDS ||
    rightGap > MAX_EVENT_GAP_SECONDS
  ) {
    return 0
  }

  const leftInterval = left.pitch - leftPrevious.pitch
  const rightInterval = right.pitch - rightPrevious.pitch

  if (directionOf(leftInterval) !== directionOf(rightInterval)) {
    return 0
  }

  const difference = Math.abs(leftInterval - rightInterval)
  const pitchScore =
    difference <= 0.35 ? 1 : difference <= 1.25 ? 0.88 : difference <= 2.25 ? 0.7 : 0

  if (pitchScore === 0) {
    return 0
  }

  const rhythmDeviation = Math.abs(
    Math.log((rightGap / leftGap) / Math.max(timeScale, 0.001)),
  )
  const rhythmScore = clamp(1 - rhythmDeviation / 0.46, 0, 1)

  if (rhythmScore < 0.62) {
    return 0
  }

  return pitchScore * 0.78 + rhythmScore * 0.22
}

const rangesOverlap = (left: LineRange, right: LineRange) =>
  left.lineId === right.lineId &&
  left.startIndex <= right.endIndex &&
  right.startIndex <= left.endIndex

const extendMotifMatch = (
  left: MotifWindow,
  right: MotifWindow,
  seedScore: number,
  lines: ReadonlyMap<string, MelodicLine>,
  lockStart: boolean,
): ExtendedMatch | null => {
  const leftLine = lines.get(left.lineId)
  const rightLine = lines.get(right.lineId)

  if (!leftLine || !rightLine) {
    return null
  }

  const ratios = left.onsetGaps
    .map((gap, index) => (right.onsetGaps[index] ?? 0) / Math.max(gap, 0.001))
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
  const timeScale = Math.max(median(ratios), 0.001)
  let leftStart = left.startIndex
  let rightStart = right.startIndex
  let leftEnd = left.endIndex
  let rightEnd = right.endIndex
  let stepScoreTotal = seedScore * (WINDOW_NOTE_COUNT - 1)
  let stepCount = WINDOW_NOTE_COUNT - 1
  let backwardSoftSteps = 0
  let forwardSoftSteps = 0

  while (!lockStart && leftStart > 0 && rightStart > 0) {
    const score = stepMatchScore(
      leftLine,
      rightLine,
      leftStart,
      rightStart,
      timeScale,
    )

    if (score < 0.7 || (score < 0.86 && backwardSoftSteps >= 1)) {
      break
    }

    leftStart -= 1
    rightStart -= 1
    stepScoreTotal += score
    stepCount += 1

    if (score < 0.86) {
      backwardSoftSteps += 1
    }
  }

  while (
    leftEnd + 1 < leftLine.notes.length &&
    rightEnd + 1 < rightLine.notes.length
  ) {
    const score = stepMatchScore(
      leftLine,
      rightLine,
      leftEnd + 1,
      rightEnd + 1,
      timeScale,
    )

    if (score < 0.7 || (score < 0.86 && forwardSoftSteps >= 1)) {
      break
    }

    leftEnd += 1
    rightEnd += 1
    stepScoreTotal += score
    stepCount += 1

    if (score < 0.86) {
      forwardSoftSteps += 1
    }
  }

  const leftRange: LineRange = {
    lineId: left.lineId,
    track: left.track,
    startIndex: leftStart,
    endIndex: leftEnd,
  }
  const rightRange: LineRange = {
    lineId: right.lineId,
    track: right.track,
    startIndex: rightStart,
    endIndex: rightEnd,
  }

  if (rangesOverlap(leftRange, rightRange)) {
    return null
  }

  return {
    left: leftRange,
    right: rightRange,
    confidence: stepScoreTotal / Math.max(stepCount, 1),
  }
}

const rangeKey = (range: LineRange) =>
  `${range.lineId}:${range.startIndex}-${range.endIndex}`

const buildOccurrences = (
  members: LineRange[],
  lines: ReadonlyMap<string, MelodicLine>,
) => {
  const byLine = new Map<string, LineRange[]>()

  members.forEach((member) => {
    const lineMembers = byLine.get(member.lineId)

    if (lineMembers) {
      lineMembers.push(member)
      return
    }

    byLine.set(member.lineId, [member])
  })

  const occurrences: MotifOccurrence[] = []

  byLine.forEach((lineMembers, lineId) => {
    const line = lines.get(lineId)

    if (!line) {
      return
    }

    const sorted = [...lineMembers].sort(
      (a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex,
    )
    let rangeStart = sorted[0]?.startIndex
    let rangeEnd = sorted[0]?.endIndex

    const pushRange = () => {
      if (rangeStart === undefined || rangeEnd === undefined) {
        return
      }

      const notes = line.notes.slice(rangeStart, rangeEnd + 1)
      const first = notes[0]
      const last = notes.at(-1)

      if (!first || !last || notes.length < WINDOW_NOTE_COUNT) {
        return
      }

      occurrences.push({
        id: `${lineId}:${rangeStart}-${rangeEnd}`,
        track: line.track,
        lineId,
        noteIds: notes.map((note) => note.id),
        start: first.start,
        end: Math.max(...notes.map((note) => note.end)),
      })
    }

    sorted.slice(1).forEach((member) => {
      if (rangeEnd !== undefined && member.startIndex <= rangeEnd + 1) {
        rangeEnd = Math.max(rangeEnd, member.endIndex)
        return
      }

      pushRange()
      rangeStart = member.startIndex
      rangeEnd = member.endIndex
    })

    pushRange()
  })

  return occurrences.sort((a, b) => a.start - b.start || a.track - b.track)
}

interface OpeningFigureSeed {
  notes: MidiNote[]
  onsetGaps: number[]
  directions: number[]
}

interface FugueSubjectSeed {
  notes: MidiNote[]
  onsetOffsets: number[]
  span: number
}

interface FugueSubjectPath {
  notes: MidiNote[]
  intervalDistance: number
}

interface FugueSubjectMatch extends FugueSubjectPath {
  track: number
  lineId?: string
  startIndex: number
  start: number
  inverted: boolean
}

interface OnsetGroupSeries {
  track: number
  lineId: string
  groups: MidiNote[][]
}

const fugueMatchKey = (match: FugueSubjectMatch) =>
  `${match.lineId ?? `track:${match.track}`}:${match.start.toFixed(4)}`

interface FugueSubjectEvaluation {
  seed: FugueSubjectSeed
  calibration: FugueSubjectMatch[]
  matches: FugueSubjectMatch[]
  distanceLimit: number
}

const buildTrackOnsetGroups = (notes: MidiNote[]): OnsetGroupSeries[] => {
  const byTrack = new Map<number, MidiNote[]>()

  notes.forEach((note) => {
    const trackNotes = byTrack.get(note.track)

    if (trackNotes) {
      trackNotes.push(note)
      return
    }

    byTrack.set(note.track, [note])
  })

  return [...byTrack.entries()]
    .sort(([left], [right]) => left - right)
    .map(([track, trackNotes]) => ({
      track,
      lineId: `track:${track}`,
      groups: groupOnsets(
        [...trackNotes].sort(
          (left, right) =>
            left.start - right.start || left.pitch - right.pitch || left.end - right.end,
        ),
      ),
    }))
}

const buildGlobalOnsetGroups = (notes: MidiNote[]): OnsetGroupSeries[] => [
  {
    track: -1,
    lineId: 'global',
    groups: groupOnsets(
      [...notes].sort(
        (left, right) =>
          left.start - right.start || left.pitch - right.pitch || left.end - right.end,
      ),
    ),
  },
]

const buildMelodicLineOnsetGroups = (notes: MidiNote[]): OnsetGroupSeries[] => {
  const lowerLines = buildMelodicLines(notes)
  const tracksWithParallelLines = new Set<number>()

  lowerLines.forEach((line) => {
    if (lowerLines.filter((candidate) => candidate.track === line.track).length > 1) {
      tracksWithParallelLines.add(line.track)
    }
  })

  return [
    ...lowerLines,
    ...buildMelodicLines(notes, true).filter((line) =>
      tracksWithParallelLines.has(line.track),
    ),
  ].map((line) => ({
    track: line.track,
    lineId: line.id,
    groups: groupOnsets(line.notes),
  }))
}

const findOpeningFigureSeed = (
  trackGroups: ReturnType<typeof buildTrackOnsetGroups>,
): OpeningFigureSeed | null => {
  for (const { groups } of trackGroups) {
    for (
      let startIndex = 0;
      startIndex + WINDOW_NOTE_COUNT <= groups.length;
      startIndex += 1
    ) {
      const window = groups.slice(startIndex, startIndex + WINDOW_NOTE_COUNT)

      if (window.some((group) => group.length !== 1)) {
        continue
      }

      const figureNotes = window.flatMap((group) => group)
      const onsetGaps = figureNotes.slice(1).map((note, index) =>
        note.start - (figureNotes[index]?.start ?? note.start),
      )

      if (
        onsetGaps.some(
          (gap) => gap <= 0 || gap > MAX_EVENT_GAP_SECONDS,
        )
      ) {
        continue
      }

      const directions = figureNotes.slice(1).map((note, index) =>
        directionOf(note.pitch - (figureNotes[index]?.pitch ?? note.pitch)),
      )

      if (directions.some((direction) => direction === 's')) {
        continue
      }

      return {
        notes: figureNotes,
        onsetGaps,
        directions: directions.map((direction) =>
          direction === 'u' ? 1 : -1,
        ),
      }
    }
  }

  return null
}

const findOnsetGroupAtTimeWithin = (
  groups: MidiNote[][],
  time: number,
  tolerance: number,
) => {
  let low = 0
  let high = groups.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const group = groups[middle]
    const start = group?.[0]?.start ?? 0

    if (start < time) {
      low = middle + 1
      continue
    }

    high = middle - 1
  }

  const candidates = [groups[low], groups[low - 1]].filter(
    (group): group is MidiNote[] => group !== undefined,
  )
  const closest = candidates.reduce<MidiNote[] | null>((best, group) => {
    if (!best) {
      return group
    }

    const bestDistance = Math.abs((best[0]?.start ?? 0) - time)
    const distance = Math.abs((group[0]?.start ?? 0) - time)

    return distance < bestDistance ? group : best
  }, null)

  if (
    !closest ||
    Math.abs((closest[0]?.start ?? 0) - time) > tolerance
  ) {
    return null
  }

  return closest
}

const findBestFigurePath = (
  groups: MidiNote[][],
  seed: OpeningFigureSeed,
) => {
  let paths: MidiNote[][] = [[]]

  groups.forEach((group) => {
    paths = paths.flatMap((path) =>
      group.map((note) => [...path, note]),
    )

    if (paths.length > MAX_FIGURE_PATHS) {
      paths = paths.slice(0, MAX_FIGURE_PATHS)
    }
  })

  let best: { notes: MidiNote[]; intervalDistance: number } | null = null

  for (const path of paths) {
    const intervals = path.slice(1).map((note, index) =>
      note.pitch - (path[index]?.pitch ?? note.pitch),
    )
    const directionsMatch = intervals.every(
      (interval, index) =>
        (interval > 0 ? 1 : interval < 0 ? -1 : 0) === seed.directions[index],
    )

    if (!directionsMatch) {
      continue
    }

    const intervalDistance = intervals.reduce(
      (sum, interval, index) =>
        sum +
        Math.abs(
          interval -
            (seed.notes[index + 1]?.pitch ?? interval) +
            (seed.notes[index]?.pitch ?? 0),
        ),
      0,
    )

    if (intervalDistance > MAX_FIGURE_INTERVAL_DISTANCE) {
      continue
    }

    if (!best || intervalDistance < best.intervalDistance) {
      best = { notes: path, intervalDistance }
    }
  }

  return best
}

const hasComparableFigureRhythm = (
  notes: MidiNote[],
  seed: OpeningFigureSeed,
) => {
  const ratios = notes.slice(1).map((note, index) => {
    const gap = note.start - (notes[index]?.start ?? note.start)
    const seedGap = seed.onsetGaps[index] ?? gap

    return gap / Math.max(seedGap, 0.001)
  })
  const smallest = Math.min(...ratios)
  const largest = Math.max(...ratios)

  return (
    Number.isFinite(smallest) &&
    smallest > 0 &&
    largest / smallest <= MAX_FIGURE_RHYTHM_SPREAD
  )
}

const buildFugueSubjectSeed = (
  groups: MidiNote[][],
  requireEvenRhythm = false,
) => {
  if (
    groups.length < FUGUE_MIN_NOTE_COUNT ||
    groups.some((group) => group.length !== 1)
  ) {
    return null
  }

  const notes = groups.flatMap((group) => group)
  const onsetOffsets = notes.map(
    (note) => note.start - (notes[0]?.start ?? note.start),
  )
  const intervals = notes.slice(1).map((note, index) =>
    note.pitch - (notes[index]?.pitch ?? note.pitch),
  )
  const onsetGaps = onsetOffsets.slice(1).map(
    (offset, index) => offset - (onsetOffsets[index] ?? offset),
  )

  if (
    intervals.some(
      (interval) => interval === 0 || Math.abs(interval) > MAX_FIGURE_INTERVAL_DISTANCE,
    )
  ) {
    return null
  }

  if (requireEvenRhythm) {
    const shortestGap = Math.min(...onsetGaps)
    const longestGap = Math.max(...onsetGaps)

    if (
      shortestGap <= 0 ||
      longestGap / Math.max(shortestGap, 0.001) > 1.14
    ) {
      return null
    }
  }

  return {
    notes,
    onsetOffsets,
    span: onsetOffsets.at(-1) ?? 0,
  } satisfies FugueSubjectSeed
}

const findBestFugueSubjectPath = (
  groups: MidiNote[][],
  seed: FugueSubjectSeed,
  inverted: boolean,
  maxIntervalDeviation = FUGUE_MAX_INTERVAL_DEVIATION,
) => {
  let paths = (groups[0] ?? []).map((note) => ({
    notes: [note],
    intervalDistance: 0,
  }))

  for (let index = 1; index < groups.length; index += 1) {
    const group = groups[index] ?? []
    const expectedInterval =
      ((seed.notes[index]?.pitch ?? 0) -
        (seed.notes[index - 1]?.pitch ?? 0)) *
      (inverted ? -1 : 1)

    paths = paths.flatMap((path) =>
      group.flatMap((note) => {
        const previous = path.notes.at(-1)

        if (!previous) {
          return []
        }

        const actualInterval = note.pitch - previous.pitch

        const intervalDeviation = Math.abs(actualInterval - expectedInterval)

        if (
          directionOf(actualInterval) !== directionOf(expectedInterval) ||
          intervalDeviation > maxIntervalDeviation
        ) {
          return []
        }

        return [
          {
            notes: [...path.notes, note],
            intervalDistance: path.intervalDistance + intervalDeviation,
          },
        ]
      }),
    )

    paths.sort(
      (left, right) => left.intervalDistance - right.intervalDistance,
    )
    paths = paths.slice(0, MAX_FIGURE_PATHS)

    if (paths.length === 0) {
      return null
    }
  }

  const best = paths[0]

  if (!best) {
    return null
  }

  return best satisfies FugueSubjectPath
}

const collectFugueSubjectMatches = (
  trackGroups: ReturnType<typeof buildTrackOnsetGroups>,
  seed: FugueSubjectSeed,
  maxIntervalDeviation = FUGUE_MAX_INTERVAL_DEVIATION,
) => {
  const matches: FugueSubjectMatch[] = []

  trackGroups.forEach(({ track, lineId, groups }) => {
    for (let startIndex = 0; startIndex < groups.length; startIndex += 1) {
      const start = groups[startIndex]?.[0]?.start

      if (start === undefined) {
        continue
      }

      const figureGroups = seed.onsetOffsets.map((offset) =>
        findOnsetGroupAtTimeWithin(
          groups,
          start + offset,
          FUGUE_ONSET_TOLERANCE,
        ),
      )

      if (figureGroups.some((group) => group === null)) {
        continue
      }

      const matchedGroups = figureGroups as MidiNote[][]

      for (const inverted of [false]) {
        const path = findBestFugueSubjectPath(
          matchedGroups,
          seed,
          inverted,
          maxIntervalDeviation,
        )

        if (!path) {
          continue
        }

        matches.push({
          ...path,
          track,
          lineId,
          startIndex,
          start,
          inverted,
        })
      }
    }
  })

  const bestByStart = new Map<string, FugueSubjectMatch>()

  matches.forEach((match) => {
    const key = `${match.track}:${match.start.toFixed(4)}`
    const existing = bestByStart.get(key)

    if (
      !existing ||
      match.intervalDistance < existing.intervalDistance ||
      (match.intervalDistance === existing.intervalDistance &&
        !match.inverted &&
        existing.inverted)
    ) {
      bestByStart.set(key, match)
    }
  })

  return [...bestByStart.values()].map((match) => ({
    ...match,
    intervalDistance:
      match.intervalDistance / Math.max(seed.notes.length - 1, 1),
  }))
}

const collectSequentialSubjectVariants = (
  notes: MidiNote[],
  seed: FugueSubjectSeed,
) => {
  if (seed.notes.length < SHORT_SUBJECT_VARIANT_MIN_NOTE_COUNT) {
    return []
  }

  const seedIntervals = motifIntervals(seed.notes)
  const seedGaps = motifOnsetGaps(seed.notes)
  const matches: FugueSubjectMatch[] = []
  const lines = [
    ...buildMelodicLines(notes),
    ...buildMelodicLines(notes, true),
  ]

  lines.forEach((line) => {
    for (
      let startIndex = 0;
      startIndex + seed.notes.length <= line.notes.length;
      startIndex += 1
    ) {
      const candidateNotes = line.notes.slice(
        startIndex,
        startIndex + seed.notes.length,
      )
      const candidateGaps = motifOnsetGaps(candidateNotes)

      if (
        candidateGaps.some(
          (gap) => gap <= 0 || gap > MAX_EVENT_GAP_SECONDS,
        )
      ) {
        continue
      }

      const rhythmRatios = candidateGaps.map(
        (gap, index) => gap / Math.max(seedGaps[index] ?? gap, 0.001),
      )
      const smallestRhythmRatio = Math.min(...rhythmRatios)
      const largestRhythmRatio = Math.max(...rhythmRatios)

      if (
        !Number.isFinite(smallestRhythmRatio) ||
        smallestRhythmRatio <= 0 ||
        largestRhythmRatio / smallestRhythmRatio >
          SHORT_SUBJECT_VARIANT_RHYTHM_SPREAD
      ) {
        continue
      }

      const intervalDistance = seedIntervals.reduce(
        (sum, expectedInterval, index) => {
          const actualInterval =
            (candidateNotes[index + 1]?.pitch ?? 0) -
            (candidateNotes[index]?.pitch ?? 0)
          const deviation = Math.abs(actualInterval - expectedInterval)

          if (
            directionOf(actualInterval) !== directionOf(expectedInterval) ||
            deviation > SHORT_SUBJECT_VARIANT_MAX_INTERVAL_DEVIATION
          ) {
            return Number.POSITIVE_INFINITY
          }

          return sum + deviation
        },
        0,
      )
      const averageDistance =
        intervalDistance / Math.max(seedIntervals.length, 1)

      if (
        !Number.isFinite(averageDistance) ||
        averageDistance > SHORT_SUBJECT_VARIANT_DISTANCE_LIMIT
      ) {
        continue
      }

      matches.push({
        notes: candidateNotes,
        intervalDistance: averageDistance,
        track: line.track,
        lineId: line.id,
        startIndex,
        start: candidateNotes[0]?.start ?? 0,
        inverted: false,
      })
    }
  })

  const bestByStart = new Map<string, FugueSubjectMatch>()

  matches.forEach((match) => {
    const key = `${match.track}:${match.start.toFixed(4)}`
    const existing = bestByStart.get(key)

    if (!existing || match.intervalDistance < existing.intervalDistance) {
      bestByStart.set(key, match)
    }
  })

  return [...bestByStart.values()]
}

const collectTempoFlexibleSubjectEntries = (
  trackGroups: ReturnType<typeof buildTrackOnsetGroups>,
  seed: FugueSubjectSeed,
) => {
  if (seed.notes.length < TEMPO_FLEXIBLE_SUBJECT_MIN_NOTE_COUNT) {
    return []
  }

  const seedGaps = motifOnsetGaps(seed.notes)
  const matches: FugueSubjectMatch[] = []

  trackGroups.forEach(({ track, lineId, groups }) => {
    for (
      let startIndex = 0;
      startIndex + seed.notes.length <= groups.length;
      startIndex += 1
    ) {
      const candidateGroups = groups.slice(
        startIndex,
        startIndex + seed.notes.length,
      )
      const candidateGaps = candidateGroups.slice(1).map(
        (group, index) =>
          (group[0]?.start ?? 0) -
          (candidateGroups[index]?.[0]?.start ?? 0),
      )

      if (
        candidateGaps.some(
          (gap) => gap <= 0 || gap > MAX_EVENT_GAP_SECONDS,
        )
      ) {
        continue
      }

      const rhythmRatios = candidateGaps.map(
        (gap, index) => gap / Math.max(seedGaps[index] ?? gap, 0.001),
      )
      const smallestRhythmRatio = Math.min(...rhythmRatios)
      const largestRhythmRatio = Math.max(...rhythmRatios)

      if (
        !Number.isFinite(smallestRhythmRatio) ||
        smallestRhythmRatio <= 0 ||
        largestRhythmRatio / smallestRhythmRatio >
          TEMPO_FLEXIBLE_SUBJECT_RHYTHM_SPREAD
      ) {
        continue
      }

      const path = findBestFugueSubjectPath(
        candidateGroups,
        seed,
        false,
        TEMPO_FLEXIBLE_SUBJECT_MAX_INTERVAL_DEVIATION,
      )

      if (!path) {
        continue
      }

      const intervalDistance =
        path.intervalDistance / Math.max(seed.notes.length - 1, 1)

      if (intervalDistance > TEMPO_FLEXIBLE_SUBJECT_DISTANCE_LIMIT) {
        continue
      }

      matches.push({
        ...path,
        intervalDistance,
        track,
        lineId,
        startIndex,
        start: candidateGroups[0]?.[0]?.start ?? 0,
        inverted: false,
      })
    }
  })

  const bestByStart = new Map<string, FugueSubjectMatch>()

  matches.forEach((match) => {
    const key = fugueMatchKey(match)
    const existing = bestByStart.get(key)

    if (!existing || match.intervalDistance < existing.intervalDistance) {
      bestByStart.set(key, match)
    }
  })

  return [...bestByStart.values()]
}

const findFugueExposition = (
  matches: FugueSubjectMatch[],
  seed: FugueSubjectSeed,
) => {
  const exposition: FugueSubjectMatch[] = []

  matches
    .filter(
      (match) => match.intervalDistance <= FUGUE_INITIAL_DISTANCE_LIMIT,
    )
    .sort((left, right) => left.start - right.start || left.track - right.track)
    .forEach((match) => {
      if (exposition.length >= FUGUE_EXPOSITION_ENTRIES) {
        return
      }

      const previous = exposition.at(-1)

      if (
        previous &&
        match.start - previous.start < seed.span * FUGUE_ENTRY_SEPARATION
      ) {
        return
      }

      exposition.push(match)
    })

  if (exposition.length < FUGUE_EXPOSITION_ENTRIES) {
    return null
  }

  const gaps = exposition.slice(1).map((match, index) =>
    match.start - (exposition[index]?.start ?? match.start),
  )
  const smallestGap = Math.min(...gaps)
  const largestGap = Math.max(...gaps)

  if (
    smallestGap <= 0 ||
    largestGap / Math.max(smallestGap, 0.001) > FUGUE_EXPOSITION_GAP_RATIO
  ) {
    return null
  }

  return exposition
}

const removeWeakOverlappingEntries = (
  matches: FugueSubjectMatch[],
  seed: FugueSubjectSeed,
) => {
  const retained: FugueSubjectMatch[] = []

  matches
    .sort((left, right) => left.start - right.start || left.track - right.track)
    .forEach((match) => {
      const previousIndex = retained.findLastIndex(
        (candidate) =>
          candidate.track === match.track &&
          match.start - candidate.start < seed.span * FUGUE_ENTRY_SEPARATION,
      )
      const previous = retained[previousIndex]

      if (
        !previous ||
        (previous.intervalDistance <= FUGUE_EXACT_OVERLAP_DISTANCE &&
          match.intervalDistance <= FUGUE_EXACT_OVERLAP_DISTANCE)
      ) {
        retained.push(match)
        return
      }

      if (match.intervalDistance < previous.intervalDistance) {
        retained[previousIndex] = match
      }
    })

  return retained
}

const evaluateFugueSubjectSeed = (
  trackGroups: ReturnType<typeof buildTrackOnsetGroups>,
  seed: FugueSubjectSeed,
) => {
  const rawMatches = collectFugueSubjectMatches(trackGroups, seed)
  const calibration = findFugueExposition(rawMatches, seed)

  if (!calibration) {
    return null
  }

  const distanceLimit = Math.max(
    FUGUE_BASE_DISTANCE_LIMIT,
    ...calibration.map((match) => match.intervalDistance + 0.05),
  )
  const matches = removeWeakOverlappingEntries(
    rawMatches.filter((match) => match.intervalDistance <= distanceLimit),
    seed,
  )

  if (matches.length < FUGUE_EXPOSITION_ENTRIES) {
    return null
  }

  return {
    seed,
    calibration,
    matches,
    distanceLimit,
  } satisfies FugueSubjectEvaluation
}

const findPolyphonicFugueHeadCandidate = (notes: MidiNote[]) => {
  const trackGroups = buildTrackOnsetGroups(notes)
  const openingTrack = [...trackGroups]
    .filter(({ groups }) => groups.length > POLYPHONIC_FUGUE_HEAD_NOTE_COUNT)
    .sort(
      (left, right) =>
        (left.groups[0]?.[0]?.start ?? Infinity) -
          (right.groups[0]?.[0]?.start ?? Infinity) ||
        left.track - right.track,
    )[0]

  if (!openingTrack) {
    return null
  }

  const headGroups = openingTrack.groups.slice(
    0,
    POLYPHONIC_FUGUE_HEAD_NOTE_COUNT,
  )
  const followingGroup = openingTrack.groups[POLYPHONIC_FUGUE_HEAD_NOTE_COUNT]

  if (
    headGroups.length !== POLYPHONIC_FUGUE_HEAD_NOTE_COUNT ||
    headGroups.some((group) => group.length !== 1) ||
    !followingGroup ||
    followingGroup.length < 2
  ) {
    return null
  }

  const seedNotes = headGroups.flatMap((group) => group)
  const onsetOffsets = seedNotes.map(
    (note) => note.start - (seedNotes[0]?.start ?? note.start),
  )
  const seed: FugueSubjectSeed = {
    notes: seedNotes,
    onsetOffsets,
    span: onsetOffsets.at(-1) ?? 0,
  }
  const entryStarts = buildMelodicLines(notes).flatMap((line) =>
    [...findEntryIndexes(line)].map(
      (index) => line.notes[index]?.start ?? Number.NaN,
    ),
  )
  const matches = collectFugueSubjectMatches(
    trackGroups,
    seed,
    POLYPHONIC_MAX_INTERVAL_DEVIATION,
  ).filter((match) =>
    entryStarts.some(
      (entryStart) =>
        Math.abs(entryStart - match.start) <= POLYPHONIC_ENTRY_TOLERANCE,
    ),
  )

  if (matches.length < FUGUE_EXPOSITION_ENTRIES) {
    return null
  }

  const averageDistance =
    matches.reduce((sum, match) => sum + match.intervalDistance, 0) /
    Math.max(matches.length, 1)
  const occurrences = matches.map<MotifOccurrence>((match) => ({
    id: `polyphonic-fugue:${match.track}:${match.startIndex}`,
    track: match.notes[0]?.track ?? match.track,
    lineId: `polyphonic-fugue:${match.track}`,
    noteIds: match.notes.map((note) => note.id),
    start: match.start,
    end: Math.max(...match.notes.map((note) => note.end)),
    form: match.inverted ? 'inversion' : 'direct',
  }))

  return {
    noteCount: seed.notes.length,
    confidence: clamp(1 - averageDistance / 4, 0.76, 0.98),
    entryOccurrences: occurrences.length,
    openingOccurrences: 1,
    earliestEntryStart: seed.notes[0]?.start ?? 0,
    occurrences,
  } satisfies MotifCandidate
}

const findFugueSubjectCandidateInGroups = (
  notes: MidiNote[],
  trackGroups: ReturnType<typeof buildTrackOnsetGroups>,
  requireEvenRhythm: boolean,
) => {
  const openingTrack = [...trackGroups]
    .filter(({ groups }) => groups.length >= FUGUE_MIN_NOTE_COUNT)
    .sort(
      (left, right) =>
        (left.groups[0]?.[0]?.start ?? Infinity) -
          (right.groups[0]?.[0]?.start ?? Infinity) ||
        left.track - right.track,
    )[0]

  if (!openingTrack) {
    return null
  }

  const evaluations = Array.from(
    {
      length: FUGUE_MAX_NOTE_COUNT - FUGUE_MIN_NOTE_COUNT + 1,
    },
    (_, index) => FUGUE_MIN_NOTE_COUNT + index,
  )
    .map((noteCount) =>
      buildFugueSubjectSeed(
        openingTrack.groups.slice(0, noteCount),
        requireEvenRhythm,
      ),
    )
    .filter((seed): seed is FugueSubjectSeed => seed !== null)
    .map((seed) => evaluateFugueSubjectSeed(trackGroups, seed))
    .filter(
      (evaluation): evaluation is FugueSubjectEvaluation => evaluation !== null,
    )

  const selected = evaluations.sort((left, right) => {
    const leftCalibrationDistance = Math.max(
      ...left.calibration.map((match) => match.intervalDistance),
    )
    const rightCalibrationDistance = Math.max(
      ...right.calibration.map((match) => match.intervalDistance),
    )

    return (
      right.matches.length - left.matches.length ||
      leftCalibrationDistance - rightCalibrationDistance ||
      right.seed.notes.length - left.seed.notes.length
    )
  })[0]

  if (!selected) {
    return null
  }

  const tempoFlexibleEntries = collectTempoFlexibleSubjectEntries(
    trackGroups,
    selected.seed,
  )
  const variants =
    selected.matches.length >= 12
      ? collectSequentialSubjectVariants(notes, selected.seed)
      : []
  const bestByStart = new Map<string, FugueSubjectMatch>()

  ;[...selected.matches, ...tempoFlexibleEntries, ...variants].forEach((match) => {
    const key = `${match.track}:${match.start.toFixed(4)}`
    const existing = bestByStart.get(key)

    if (!existing || match.intervalDistance < existing.intervalDistance) {
      bestByStart.set(key, match)
    }
  })
  const matches = [...bestByStart.values()].sort(
    (left, right) => left.start - right.start || left.track - right.track,
  )

  const averageDistance =
    matches.reduce(
      (sum, match) => sum + match.intervalDistance,
      0,
    ) / Math.max(matches.length, 1)
  const occurrences = matches.map<MotifOccurrence>((match) => ({
    id: `fugue-subject:${match.track}:${match.startIndex}`,
    track: match.notes[0]?.track ?? match.track,
    lineId: `fugue-subject:${match.track}`,
    noteIds: match.notes.map((note) => note.id),
    start: match.start,
    end: Math.max(...match.notes.map((note) => note.end)),
    form: match.inverted ? 'inversion' : 'direct',
  }))

  return {
    noteCount: selected.seed.notes.length,
    confidence: clamp(
      1 - averageDistance / Math.max(selected.distanceLimit * 2.5, 0.001),
      0.76,
      0.98,
    ),
    entryOccurrences: matches.length,
    openingOccurrences: 1,
    earliestEntryStart: selected.seed.notes[0]?.start ?? 0,
    occurrences,
  } satisfies MotifCandidate
}

const findFugueSubjectCandidate = (notes: MidiNote[]) =>
  findPolyphonicFugueHeadCandidate(notes) ??
  findFugueSubjectCandidateInGroups(
    notes,
    buildGlobalOnsetGroups(notes),
    true,
  ) ??
  findFugueSubjectCandidateInGroups(
    notes,
    buildTrackOnsetGroups(notes),
    false,
  )

const findFourPartExpositionCandidate = (notes: MidiNote[]) => {
  const trackGroups = buildTrackOnsetGroups(notes)

  if (trackGroups.length < FUGUE_EXPOSITION_ENTRIES) {
    return null
  }

  const expositionTrackGroups = [...trackGroups]
    .sort(
      (left, right) =>
        (left.groups[0]?.[0]?.start ?? Infinity) -
          (right.groups[0]?.[0]?.start ?? Infinity) ||
        left.track - right.track,
    )
    .slice(0, FUGUE_EXPOSITION_ENTRIES)

  const openingTrack = [...expositionTrackGroups]
    .filter(({ groups }) => groups.length >= FUGUE_MIN_NOTE_COUNT)
    .sort(
      (left, right) =>
        (left.groups[0]?.[0]?.start ?? Infinity) -
          (right.groups[0]?.[0]?.start ?? Infinity) ||
        left.track - right.track,
    )[0]

  if (!openingTrack) {
    return null
  }

  const candidates = Array.from(
    { length: FUGUE_MAX_NOTE_COUNT - FUGUE_MIN_NOTE_COUNT + 1 },
    (_, index) => FUGUE_MIN_NOTE_COUNT + index,
  )
    .map((noteCount) =>
      buildFugueSubjectSeed(openingTrack.groups.slice(0, noteCount)),
    )
    .filter((seed): seed is FugueSubjectSeed => seed !== null)
    .map((seed) => {
      const matches = expositionTrackGroups.flatMap(({ track, lineId, groups }) => {
        const candidateGroups = groups.slice(0, seed.notes.length)

        if (candidateGroups.length !== seed.notes.length) {
          return []
        }

        const candidateNotes = candidateGroups.flatMap((group) => group)
        const candidateGaps = motifOnsetGaps(candidateNotes)
        const seedGaps = motifOnsetGaps(seed.notes)
        const ratios = candidateGaps.map(
          (gap, index) => gap / Math.max(seedGaps[index] ?? gap, 0.001),
        )
        const smallestRatio = Math.min(...ratios)
        const largestRatio = Math.max(...ratios)

        if (
          !Number.isFinite(smallestRatio) ||
          smallestRatio <= 0 ||
          largestRatio / smallestRatio > MAX_FIGURE_RHYTHM_SPREAD
        ) {
          return []
        }

        return [false, true]
          .map<FugueSubjectMatch | null>((inverted) => {
            const path = findBestFugueSubjectPath(
              candidateGroups,
              seed,
              inverted,
            )

            if (!path) {
              return null
            }

            const intervalDistance =
              path.intervalDistance / Math.max(seed.notes.length - 1, 1)

            if (intervalDistance > FUGUE_INITIAL_DISTANCE_LIMIT) {
              return null
            }

            return {
              ...path,
              intervalDistance,
              track,
              lineId,
              startIndex: 0,
              start: candidateGroups[0]?.[0]?.start ?? 0,
              inverted,
            } satisfies FugueSubjectMatch
          })
          .filter((match): match is FugueSubjectMatch => match !== null)
          .sort(
            (left, right) =>
              left.intervalDistance - right.intervalDistance ||
              Number(left.inverted) - Number(right.inverted),
          )
          .slice(0, 1)
      })

      if (matches.length !== FUGUE_EXPOSITION_ENTRIES) {
        return null
      }

      const starts = matches.map((match) => match.start)
      const firstStart = Math.min(...starts)
      const lastStart = Math.max(...starts)

      if (lastStart - firstStart > seed.span * 8.5) {
        return null
      }

      return { seed, matches }
    })
    .filter(
      (
        candidate,
      ): candidate is { seed: FugueSubjectSeed; matches: FugueSubjectMatch[] } =>
        candidate !== null,
    )
    .sort(
      (left, right) =>
        right.seed.notes.length - left.seed.notes.length ||
        left.matches.reduce((sum, match) => sum + match.intervalDistance, 0) -
          right.matches.reduce((sum, match) => sum + match.intervalDistance, 0),
    )

  const selected = candidates[0]

  if (!selected) {
    return null
  }

  const detectedLineGroups = buildMelodicLineOnsetGroups(notes)
  const collectFlexibleMatches = (
    sources: OnsetGroupSeries[],
    seed: FugueSubjectSeed,
  ) =>
    sources.flatMap(({ track, lineId, groups }) => {
      const matches: FugueSubjectMatch[] = []

    for (
      let startIndex = 0;
      startIndex + seed.notes.length <= groups.length;
      startIndex += 1
    ) {
      const candidateGroups = groups.slice(
        startIndex,
        startIndex + seed.notes.length,
      )
      const candidateGaps = candidateGroups.slice(1).map(
        (group, index) =>
          (group[0]?.start ?? 0) -
          (candidateGroups[index]?.[0]?.start ?? 0),
      )
      const seedGaps = motifOnsetGaps(seed.notes)
      const ratios = candidateGaps.map(
        (gap, index) => gap / Math.max(seedGaps[index] ?? gap, 0.001),
      )
      const smallestRatio = Math.min(...ratios)
      const largestRatio = Math.max(...ratios)

      if (
        candidateGaps.some((gap) => gap <= 0 || gap > MAX_EVENT_GAP_SECONDS) ||
        !Number.isFinite(smallestRatio) ||
        smallestRatio <= 0 ||
        largestRatio / smallestRatio > MAX_FIGURE_RHYTHM_SPREAD
      ) {
        continue
      }

      for (const inverted of [false, true]) {
        const path = findBestFugueSubjectPath(
          candidateGroups,
          seed,
          inverted,
        )

        if (!path) {
          continue
        }

        const intervalDistance =
          path.intervalDistance / Math.max(seed.notes.length - 1, 1)

        if (intervalDistance > FUGUE_INITIAL_DISTANCE_LIMIT) {
          continue
        }

        matches.push({
          ...path,
          intervalDistance,
          track,
          lineId,
          startIndex,
          start: candidateGroups[0]?.[0]?.start ?? 0,
          inverted,
        })
      }
    }

      return matches
    })
  const lineIdForMatch = (match: FugueSubjectMatch) =>
    detectedLineGroups.find(
      (line) =>
        line.track === match.track &&
        line.groups.some((group) =>
          group.some((note) => note.id === match.notes[0]?.id),
        ),
    )?.lineId ?? match.lineId ?? `track:${match.track}`
  const rawFlexibleMatches = collectFlexibleMatches(trackGroups, selected.seed).map(
    (match) => ({ ...match, lineId: lineIdForMatch(match) }),
  )
  const supplementalLineMatches =
    detectedLineGroups.length > trackGroups.length
      ? collectFlexibleMatches(detectedLineGroups, selected.seed).filter(
          (match) =>
            !rawFlexibleMatches.some(
              (existing) =>
                existing.track === match.track &&
                existing.notes.some((note) =>
                  match.notes.some((candidate) => candidate.id === note.id),
                ),
            ) &&
            rawFlexibleMatches.some(
              (existing) =>
                existing.track === match.track &&
                existing.start < Math.max(...match.notes.map((note) => note.end)) &&
                match.start < Math.max(...existing.notes.map((note) => note.end)),
            ),
        )
      : []
  const flexibleMatches = [...rawFlexibleMatches, ...supplementalLineMatches]
  const matchesByStart = new Map<string, FugueSubjectMatch>()

  const initialMatches: FugueSubjectMatch[] = selected.matches.map((match) => ({
    ...match,
    lineId: lineIdForMatch(match),
  }))

  ;[...initialMatches, ...flexibleMatches].forEach((match) => {
    const key = fugueMatchKey(match)
    const existing = matchesByStart.get(key)

    if (
      !existing ||
      match.intervalDistance < existing.intervalDistance ||
      (match.intervalDistance === existing.intervalDistance &&
        !match.inverted &&
        existing.inverted)
    ) {
      matchesByStart.set(key, match)
    }
  })
  const collectCoincidentHeadVariants = () =>
    detectedLineGroups.flatMap(({ track, lineId, groups }) => {
      const variants: FugueSubjectMatch[] = []
      const headNoteCount = Math.min(5, selected.seed.notes.length)
      const continuationNoteCount = Math.min(
        FUGUE_MIN_NOTE_COUNT,
        selected.seed.notes.length,
      )
      const terminalStart = Math.max(...notes.map((note) => note.end)) * 0.85

      groups.forEach((group, startIndex) => {
        const start = group[0]?.start
        if (start === undefined || start < terminalStart) {
          return
        }

        const simultaneousMatches = [...matchesByStart.values()].filter(
          (match) =>
            Math.abs(match.start - start) <= FUGUE_ONSET_TOLERANCE &&
            !match.notes.some((note) => group.some((candidate) => candidate.id === note.id)),
        )

        if (simultaneousMatches.length === 0) {
          return
        }

        const candidateNotes = groups
          .slice(startIndex, startIndex + continuationNoteCount)
          .map((candidateGroup) => candidateGroup[0])
          .filter((note): note is MidiNote => note !== undefined)

        if (candidateNotes.length < continuationNoteCount) {
          return
        }

        const headNotes = candidateNotes.slice(0, headNoteCount)
        const actualIntervals = motifIntervals(headNotes)
        const expectedIntervals = motifIntervals(
          selected.seed.notes.slice(0, headNoteCount),
        )

        for (const inverted of [false, true]) {
          const deviations = expectedIntervals.map((expected, index) => {
            const actual = actualIntervals[index] ?? 0
            const target = inverted ? -expected : expected
            return Math.abs(actual - target)
          })
          const preservesDirection = expectedIntervals.every((expected, index) => {
            const actual = actualIntervals[index] ?? 0
            return directionOf(actual) === directionOf(inverted ? -expected : expected)
          })
          const averageDeviation =
            deviations.reduce((sum, deviation) => sum + deviation, 0) /
            Math.max(deviations.length, 1)

          if (
            !preservesDirection ||
            Math.max(...deviations) > 3 ||
            averageDeviation > 1.3 ||
            !simultaneousMatches.some(
              (match) => match.inverted !== inverted,
            )
          ) {
            continue
          }

          variants.push({
            notes: candidateNotes,
            intervalDistance: averageDeviation,
            track,
            lineId,
            startIndex,
            start,
            inverted,
          })
        }
      })

      return variants
    })
  const coincidentHeadVariants = collectCoincidentHeadVariants()

  coincidentHeadVariants.forEach((match) => {
    const key = fugueMatchKey(match)
    if (!matchesByStart.has(key)) {
      matchesByStart.set(key, match)
    }
  })
  const matches = [...matchesByStart.values()]

  return {
    noteCount: selected.seed.notes.length,
    confidence: 0.96,
    entryOccurrences: matches.length,
    openingOccurrences: 1,
    earliestEntryStart: selected.seed.notes[0]?.start ?? 0,
    occurrences: matches.map<MotifOccurrence>((match) => ({
      id: `four-part-exposition:${match.track}`,
      track: match.notes[0]?.track ?? match.track,
      lineId: match.lineId ?? `four-part-exposition:${match.track}`,
      noteIds: match.notes.map((note) => note.id),
      start: match.start,
      end: Math.max(...match.notes.map((note) => note.end)),
      form: match.inverted ? 'inversion' : 'direct',
      isVaried: coincidentHeadVariants.some(
        (variant) => fugueMatchKey(variant) === fugueMatchKey(match),
      ),
    })),
  } satisfies MotifCandidate
}

const mergeOpeningExposition = (
  subjectCandidate: MotifCandidate | null,
  expositionCandidate: MotifCandidate | null,
) => {
  if (!subjectCandidate || !expositionCandidate) {
    return subjectCandidate
  }

  const byStart = new Map<string, MotifOccurrence>()

  ;[...subjectCandidate.occurrences, ...expositionCandidate.occurrences].forEach(
    (occurrence) => {
      const key = `${occurrence.track}:${occurrence.start.toFixed(4)}`
      const existing = byStart.get(key)

      if (
        !existing ||
        occurrence.noteIds.length > existing.noteIds.length ||
        (occurrence.noteIds.length === existing.noteIds.length &&
          occurrence.id.startsWith('four-part-exposition:'))
      ) {
        byStart.set(key, occurrence)
      }
    },
  )

  return {
    ...subjectCandidate,
    noteCount: Math.max(subjectCandidate.noteCount, expositionCandidate.noteCount),
    confidence: Math.max(subjectCandidate.confidence, expositionCandidate.confidence),
    entryOccurrences: byStart.size,
    occurrences: [...byStart.values()].sort(
      (left, right) => left.start - right.start || left.track - right.track,
    ),
  } satisfies MotifCandidate
}

const expandFourPartMotifVariants = (
  notes: MidiNote[],
  candidate: MotifCandidate | null,
  hasVerifiedExposition: boolean,
) => {
  if (
    !candidate ||
    !hasVerifiedExposition ||
    candidate.occurrences.length >= 12 ||
    buildTrackOnsetGroups(notes).length < FUGUE_EXPOSITION_ENTRIES
  ) {
    return candidate
  }

  const trackGroups = buildTrackOnsetGroups(notes)
  const detectedLineGroups = buildMelodicLineOnsetGroups(notes)
  const lineGroups =
    detectedLineGroups.length > trackGroups.length
      ? detectedLineGroups
      : trackGroups
  const groupsByLine = new Map(
    lineGroups.map(({ lineId, groups }) => [lineId, groups]),
  )
  const lineIdForOccurrence = (occurrence: MotifOccurrence) => {
    if (groupsByLine.has(occurrence.lineId)) {
      return occurrence.lineId
    }

    const firstNoteId = occurrence.noteIds[0]
    return lineGroups.find(
      (line) =>
        line.track === occurrence.track &&
        line.groups.some((group) =>
          group.some((note) => note.id === firstNoteId),
        ),
    )?.lineId ?? occurrence.lineId
  }
  const primaryStartKeys = new Set(
    candidate.occurrences.map(
      (occurrence) =>
        `${lineIdForOccurrence(occurrence)}:${occurrence.start.toFixed(4)}`,
    ),
  )
  const collectMatches = (seed: FugueSubjectSeed) =>
    lineGroups.flatMap(({ track, lineId, groups }) => {
      const matches: FugueSubjectMatch[] = []

      for (
        let startIndex = 0;
        startIndex + seed.notes.length <= groups.length;
        startIndex += 1
      ) {
        const candidateGroups = groups.slice(
          startIndex,
          startIndex + seed.notes.length,
        )
        const candidateGaps = candidateGroups.slice(1).map(
          (group, index) =>
            (group[0]?.start ?? 0) -
            (candidateGroups[index]?.[0]?.start ?? 0),
        )
        const seedGaps = motifOnsetGaps(seed.notes)
        const ratios = candidateGaps.map(
          (gap, index) => gap / Math.max(seedGaps[index] ?? gap, 0.001),
        )
        const smallestRatio = Math.min(...ratios)
        const largestRatio = Math.max(...ratios)

        if (
          candidateGaps.some((gap) => gap <= 0 || gap > MAX_EVENT_GAP_SECONDS) ||
          !Number.isFinite(smallestRatio) ||
          smallestRatio <= 0 ||
          largestRatio / smallestRatio > MAX_FIGURE_RHYTHM_SPREAD
        ) {
          continue
        }

        for (const inverted of [false, true]) {
          const path = findBestFugueSubjectPath(
            candidateGroups,
            seed,
            inverted,
          )

          if (!path) {
            continue
          }

          const intervalDistance =
            path.intervalDistance / Math.max(seed.notes.length - 1, 1)

          if (intervalDistance > FUGUE_INITIAL_DISTANCE_LIMIT) {
            continue
          }

          matches.push({
            ...path,
            intervalDistance,
            track,
            lineId,
            startIndex,
            start: candidateGroups[0]?.[0]?.start ?? 0,
            inverted,
          })
        }
      }

      return matches
    })
  const variantCandidates = candidate.occurrences
    .map((occurrence) => {
      const lineId = lineIdForOccurrence(occurrence)
      const groups = groupsByLine.get(lineId) ?? []
      const startIndex = groups.findIndex(
        (group) =>
          Math.abs((group[0]?.start ?? Number.NaN) - occurrence.start) <=
          FUGUE_ONSET_TOLERANCE,
      )
      const seedGroups =
        startIndex >= 0
          ? groups.slice(startIndex, startIndex + FUGUE_MIN_NOTE_COUNT)
          : []
      const seedNotes = seedGroups
        .map((group) => group[0])
        .filter((note): note is MidiNote => note !== undefined)
      const first = seedNotes[0]

      if (!first || seedNotes.length < FUGUE_MIN_NOTE_COUNT) {
        return null
      }

      const seed: FugueSubjectSeed = {
        notes: seedNotes,
        onsetOffsets: seedNotes.map((note) => note.start - first.start),
        span: (seedNotes.at(-1)?.start ?? first.start) - first.start,
      }
      const matchesByStart = new Map<string, FugueSubjectMatch>()

      collectMatches(seed).forEach((match) => {
        const key = fugueMatchKey(match)
        const existing = matchesByStart.get(key)

        if (
          !existing ||
          match.intervalDistance < existing.intervalDistance ||
          (match.intervalDistance === existing.intervalDistance &&
            !match.inverted &&
            existing.inverted)
        ) {
          matchesByStart.set(key, match)
        }
      })

      const matches = [...matchesByStart.values()]
      const sharedCount = matches.filter((match) =>
        primaryStartKeys.has(fugueMatchKey(match)),
      ).length
      const novelCount = matches.length - sharedCount

      if (sharedCount < 2 || novelCount < 2) {
        return null
      }

      return { matches, novelCount, sharedCount }
    })
    .filter(
      (
        variant,
      ): variant is {
        matches: FugueSubjectMatch[]
        novelCount: number
        sharedCount: number
      } => variant !== null,
    )
    .sort(
      (left, right) =>
        right.novelCount - left.novelCount ||
        right.sharedCount - left.sharedCount ||
        right.matches.length - left.matches.length,
    )
  const variant = variantCandidates[0]

  if (!variant) {
    return candidate
  }

  const occurrencesByStart = new Map(
    candidate.occurrences.map((occurrence) => [
      `${lineIdForOccurrence(occurrence)}:${occurrence.start.toFixed(4)}`,
      occurrence,
    ]),
  )

  variant.matches.forEach((match) => {
    const key = fugueMatchKey(match)
    const occurrence: MotifOccurrence = {
      id: `motif-variant:${match.track}:${match.startIndex}`,
      track: match.notes[0]?.track ?? match.track,
      lineId: match.lineId ?? `motif-variant:${match.track}`,
      noteIds: match.notes.map((note) => note.id),
      start: match.start,
      end: Math.max(...match.notes.map((note) => note.end)),
      form: match.inverted ? 'inversion' : 'direct',
      isVaried: true,
    }
    const existing = occurrencesByStart.get(key)

    if (
      !existing ||
      occurrence.noteIds.length > existing.noteIds.length ||
      (occurrence.isVaried && !existing.isVaried)
    ) {
      occurrencesByStart.set(key, occurrence)
    }
  })

  return {
    ...candidate,
    entryOccurrences: occurrencesByStart.size,
    occurrences: [...occurrencesByStart.values()].sort(
      (left, right) => left.start - right.start || left.track - right.track,
    ),
  } satisfies MotifCandidate
}

interface DenseFugueMatch {
  lineId: string
  track: number
  notes: MidiNote[]
  startIndex: number
  inverted: boolean
  intervalDistance: number
}

const DENSE_FUGUE_MIN_OCCURRENCES = 24
const DENSE_FUGUE_MAX_OCCURRENCES = 44
const DENSE_FUGUE_MAX_NOTE_COUNT = 9
const DENSE_SEQUENTIAL_AVERAGE_DISTANCE_LIMIT = 0.5
const DENSE_RHYTHMIC_AVERAGE_DISTANCE_LIMIT = 1
const LONG_SUBJECT_MIN_NOTE_COUNT = 9
const LONG_SUBJECT_DISTANCE_LIMIT = 1.75
const LONG_SUBJECT_RELAXED_DISTANCE_LIMIT = 1.5
const LONG_SUBJECT_MIN_EXACT_ENTRIES = 4
const LONG_SUBJECT_MIN_OCCURRENCES = 12
const EXTENDED_SUBJECT_MIN_NOTE_COUNT = 18
const EXTENDED_SUBJECT_MAX_NOTE_COUNT = 32
const EXTENDED_SUBJECT_MIN_OCCURRENCES = 4
const FULL_OPENING_SUBJECT_MIN_NOTE_COUNT = 33
const FULL_OPENING_SUBJECT_MAX_NOTE_COUNT = 64
const FULL_OPENING_SUBJECT_MIN_OCCURRENCES = 4
const FULL_OPENING_SUBJECT_MIN_EXACT_ENTRIES = 3
const FULL_OPENING_SUBJECT_MAX_INTERVAL_DEVIATION = 2

const hasMatchingFugueDirection = (actual: number, expected: number) =>
  expected === 0 ? actual === 0 : directionOf(actual) === directionOf(expected)

const toDenseFugueCandidate = (matches: DenseFugueMatch[]) => {
  if (
    matches.length < DENSE_FUGUE_MIN_OCCURRENCES ||
    matches.length > DENSE_FUGUE_MAX_OCCURRENCES
  ) {
    return null
  }

  const averageDistance =
    matches.reduce((sum, match) => sum + match.intervalDistance, 0) /
    Math.max(matches.length, 1)
  const noteCount = matches[0]?.notes.length ?? 0

  if (noteCount < 4) {
    return null
  }

  return {
    noteCount,
    confidence: clamp(1 - averageDistance / 2, 0.76, 0.98),
    entryOccurrences: matches.length,
    openingOccurrences: 1,
    earliestEntryStart: Math.min(...matches.map((match) => match.notes[0]?.start ?? 0)),
    occurrences: matches
      .map<MotifOccurrence>((match) => ({
        id: `dense-fugue:${match.lineId}:${match.startIndex}`,
        track: match.track,
        lineId: match.lineId,
        noteIds: match.notes.map((note) => note.id),
        start: match.notes[0]?.start ?? 0,
        end: Math.max(...match.notes.map((note) => note.end)),
        form: match.inverted ? 'inversion' : 'direct',
      }))
      .sort((left, right) => left.start - right.start || left.track - right.track),
  } satisfies MotifCandidate
}

const findDenseSequentialFugueCandidate = (notes: MidiNote[]) => {
  const lines = buildMelodicLines(notes)
  const openingLine = [...lines].sort(
    (left, right) =>
      (left.notes[0]?.start ?? Infinity) -
        (right.notes[0]?.start ?? Infinity) ||
      left.track - right.track ||
      left.id.localeCompare(right.id),
  )[0]

  if (!openingLine) {
    return null
  }

  const candidates: MotifCandidate[] = []
  const maximumLength = Math.min(
    DENSE_FUGUE_MAX_NOTE_COUNT,
    openingLine.notes.length,
  )

  for (let noteCount = 4; noteCount <= maximumLength; noteCount += 1) {
    const seed = openingLine.notes.slice(0, noteCount)
    const seedIntervals = seed.slice(1).map((note, index) =>
      note.pitch - (seed[index]?.pitch ?? note.pitch),
    )

    if (
      seedIntervals.some((interval) => Math.abs(interval) > MAX_FIGURE_INTERVAL_DISTANCE) ||
      new Set(seedIntervals.map(directionOf)).size < 2
    ) {
      continue
    }

    const matches: DenseFugueMatch[] = []

    lines.forEach((line) => {
      for (
        let startIndex = 0;
        startIndex + noteCount <= line.notes.length;
        startIndex += 1
      ) {
        const candidateNotes = line.notes.slice(startIndex, startIndex + noteCount)
        const isContinuous = candidateNotes.slice(1).every((note, index) => {
          const previous = candidateNotes[index]
          return (
            previous !== undefined &&
            note.start - previous.start > 0 &&
            note.start - previous.start <= MAX_EVENT_GAP_SECONDS
          )
        })

        if (!isContinuous) {
          continue
        }

        const matchedForms = [false, true]
          .map((inverted) => {
            const intervalDistance = seedIntervals.reduce(
              (sum, expectedInterval, index) => {
                const previous = candidateNotes[index]
                const current = candidateNotes[index + 1]

                if (!previous || !current) {
                  return Number.POSITIVE_INFINITY
                }

                const actualInterval = current.pitch - previous.pitch
                const transformedInterval = inverted
                  ? -expectedInterval
                  : expectedInterval
                const difference = Math.abs(actualInterval - transformedInterval)

                if (
                  !hasMatchingFugueDirection(actualInterval, transformedInterval) ||
                  difference > 1
                ) {
                  return Number.POSITIVE_INFINITY
                }

                return sum + difference
              },
              0,
            )

            return {
              inverted,
              intervalDistance:
                intervalDistance / Math.max(seedIntervals.length, 1),
            }
          })
          .filter((form) =>
            Number.isFinite(form.intervalDistance) &&
            form.intervalDistance <= DENSE_SEQUENTIAL_AVERAGE_DISTANCE_LIMIT,
          )
          .sort((left, right) => left.intervalDistance - right.intervalDistance)

        const bestForm = matchedForms[0]

        if (!bestForm) {
          continue
        }

        matches.push({
          lineId: line.id,
          track: line.track,
          notes: candidateNotes,
          startIndex,
          inverted: bestForm.inverted,
          intervalDistance: bestForm.intervalDistance,
        })
      }
    })

    const directMatches = matches.filter((match) => !match.inverted)
    const invertedMatches = matches.filter((match) => match.inverted)
    const acceptedMatches =
      invertedMatches.length >= directMatches.length * 0.2
        ? matches
        : directMatches
    const candidate = toDenseFugueCandidate(acceptedMatches)

    if (candidate) {
      candidates.push(candidate)
    }
  }

  const cliffCandidate = candidates.find((candidate, index) => {
    const previous = candidates[index - 1]
    return (
      previous !== undefined &&
      candidate.noteCount > previous.noteCount &&
      candidate.occurrences.length <= previous.occurrences.length * 0.8
    )
  })

  return (
    cliffCandidate ??
    candidates.sort(
      (left, right) =>
        right.occurrences.length - left.occurrences.length ||
        right.noteCount - left.noteCount,
    )[0] ??
    null
  )
}

const findBestDenseFuguePath = (
  groups: MidiNote[][],
  seed: MidiNote[],
  inverted: boolean,
  maxIntervalDeviation: number,
) => {
  let paths = (groups[0] ?? []).map((note) => ({
    notes: [note],
    intervalDistance: 0,
  }))

  for (let index = 1; index < groups.length; index += 1) {
    const group = groups[index] ?? []
    const expectedInterval =
      ((seed[index]?.pitch ?? 0) - (seed[index - 1]?.pitch ?? 0)) *
      (inverted ? -1 : 1)

    paths = paths.flatMap((path) =>
      group.flatMap((note) => {
        const previous = path.notes.at(-1)

        if (!previous || note.start < previous.end - LINE_OVERLAP_TOLERANCE) {
          return []
        }

        const actualInterval = note.pitch - previous.pitch
        const intervalDeviation = Math.abs(actualInterval - expectedInterval)

        if (
          !hasMatchingFugueDirection(actualInterval, expectedInterval) ||
          intervalDeviation > maxIntervalDeviation
        ) {
          return []
        }

        return [
          {
            notes: [...path.notes, note],
            intervalDistance: path.intervalDistance + intervalDeviation,
          },
        ]
      }),
    )

    paths.sort((left, right) => left.intervalDistance - right.intervalDistance)
    paths = paths.slice(0, MAX_FIGURE_PATHS)

    if (paths.length === 0) {
      return null
    }
  }

  const best = paths[0]

  if (!best) {
    return null
  }

  return {
    ...best,
    intervalDistance: best.intervalDistance / Math.max(seed.length - 1, 1),
  }
}

const findDenseRhythmicFugueCandidate = (notes: MidiNote[]) => {
  const trackGroups = buildTrackOnsetGroups(notes)
  const openingTrack = [...trackGroups]
    .filter(({ groups }) => groups.length >= 4)
    .sort(
      (left, right) =>
        (left.groups[0]?.[0]?.start ?? Infinity) -
          (right.groups[0]?.[0]?.start ?? Infinity) ||
        left.track - right.track,
    )[0]

  if (!openingTrack) {
    return null
  }

  const candidates: Array<{
    candidate: MotifCandidate
    maxIntervalDeviation: number
  }> = []
  const maximumLength = Math.min(
    DENSE_FUGUE_MAX_NOTE_COUNT,
    openingTrack.groups.length,
  )

  for (const maxIntervalDeviation of [1, 2, 3]) {
    for (let noteCount = 4; noteCount <= maximumLength; noteCount += 1) {
      const seed = openingTrack.groups
        .slice(0, noteCount)
        .map((group) => group[0])

      if (seed.some((note) => note === undefined)) {
        continue
      }

      const seedNotes = seed as MidiNote[]
      const offsets = seedNotes.map(
        (note) => note.start - (seedNotes[0]?.start ?? note.start),
      )
      const matches: DenseFugueMatch[] = []

      trackGroups.forEach(({ track, groups }) => {
        for (let startIndex = 0; startIndex < groups.length; startIndex += 1) {
          const start = groups[startIndex]?.[0]?.start

          if (start === undefined) {
            continue
          }

          const matchedGroups = offsets.map((offset) =>
            findOnsetGroupAtTimeWithin(
              groups,
              start + offset,
              FUGUE_ONSET_TOLERANCE,
            ),
          )

          if (matchedGroups.some((group) => group === null)) {
            continue
          }

          const forms = [false, true]
            .map((inverted) => {
              const path = findBestDenseFuguePath(
                matchedGroups as MidiNote[][],
                seedNotes,
                inverted,
                maxIntervalDeviation,
              )

              return path ? { inverted, path } : null
            })
            .filter(
              (form): form is { inverted: boolean; path: FugueSubjectPath } =>
                form !== null &&
                form.path.intervalDistance <=
                  Math.max(
                    DENSE_RHYTHMIC_AVERAGE_DISTANCE_LIMIT,
                    maxIntervalDeviation,
                  ),
            )
            .sort((left, right) =>
              left.path.intervalDistance - right.path.intervalDistance,
            )
          const bestForm = forms[0]

          if (!bestForm) {
            continue
          }

          matches.push({
            lineId: `dense-rhythm:${track}`,
            track,
            notes: bestForm.path.notes,
            startIndex,
            inverted: bestForm.inverted,
            intervalDistance: bestForm.path.intervalDistance,
          })
        }
      })

      const candidate = toDenseFugueCandidate(matches)

      if (candidate && candidate.occurrences.length >= 30) {
        candidates.push({ candidate, maxIntervalDeviation })
      }
    }
  }

  return candidates.sort(
    (left, right) =>
      right.candidate.noteCount - left.candidate.noteCount ||
      right.candidate.occurrences.length - right.maxIntervalDeviation * 2 -
        (left.candidate.occurrences.length - left.maxIntervalDeviation * 2),
  )[0]?.candidate ?? null
}

const findDenseFugueCandidate = (notes: MidiNote[]) => {
  const sequential = findDenseSequentialFugueCandidate(notes)
  const rhythmicCandidate = findDenseRhythmicFugueCandidate(notes)
  const rhythmic =
    rhythmicCandidate && rhythmicCandidate.noteCount >= 6
      ? rhythmicCandidate
      : null

  if (
    sequential &&
    (!rhythmic || sequential.noteCount >= rhythmic.noteCount)
  ) {
    return sequential
  }

  return rhythmic ?? sequential
}

const findLongSubjectTransformCandidate = (notes: MidiNote[]) => {
  const lines = buildMelodicLines(notes)
  const openingLine = [...lines].sort(
    (left, right) =>
      (left.notes[0]?.start ?? Infinity) -
        (right.notes[0]?.start ?? Infinity) ||
      left.track - right.track ||
      left.id.localeCompare(right.id),
  )[0]

  if (!openingLine || openingLine.notes.length < LONG_SUBJECT_MIN_NOTE_COUNT) {
    return null
  }

  const seed = openingLine.notes.slice(0, LONG_SUBJECT_MIN_NOTE_COUNT)
  const seedIntervals = motifIntervals(seed)

  if (
    seedIntervals.some(
      (interval) => interval === 0 || Math.abs(interval) > MAX_FIGURE_INTERVAL_DISTANCE,
    ) ||
    new Set(seedIntervals.map(directionOf)).size < 2
  ) {
    return null
  }

  const matches: DenseFugueMatch[] = []
  const minimumDirections = seedIntervals.length - 1

  lines.forEach((line) => {
    for (
      let startIndex = 0;
      startIndex + seed.length <= line.notes.length;
      startIndex += 1
    ) {
      const candidateNotes = line.notes.slice(startIndex, startIndex + seed.length)
      const isContinuous = candidateNotes.slice(1).every((note, index) => {
        const previous = candidateNotes[index]
        const gap = note.start - (previous?.start ?? note.start)
        return gap > 0 && gap <= MAX_EVENT_GAP_SECONDS
      })

      if (!isContinuous) {
        continue
      }

      const bestForm = [false, true]
        .map((inverted) => {
          const expectedIntervals = seedIntervals.map((interval) =>
            inverted ? -interval : interval,
          )
          const actualIntervals = motifIntervals(candidateNotes)
          const intervalDistance = averageIntervalDistance(
            actualIntervals,
            expectedIntervals,
            false,
          )
          const matchingDirections = actualIntervals.reduce(
            (count, interval, index) =>
              count +
              (hasMatchingFugueDirection(
                interval,
                expectedIntervals[index] ?? interval,
              )
                ? 1
                : 0),
            0,
          )
          const exact =
            intervalDistance <= DENSE_SEQUENTIAL_AVERAGE_DISTANCE_LIMIT &&
            matchingDirections === seedIntervals.length
          const accepted =
            (intervalDistance <= LONG_SUBJECT_DISTANCE_LIMIT &&
              matchingDirections >= minimumDirections) ||
            (intervalDistance <= LONG_SUBJECT_RELAXED_DISTANCE_LIMIT &&
              matchingDirections >= minimumDirections - 1)

          return {
            inverted,
            intervalDistance,
            matchingDirections,
            exact,
            accepted,
          }
        })
        .filter((form) => form.accepted)
        .sort(
          (left, right) =>
            right.matchingDirections - left.matchingDirections ||
            left.intervalDistance - right.intervalDistance ||
            Number(left.inverted) - Number(right.inverted),
        )[0]

      if (!bestForm) {
        continue
      }

      matches.push({
        lineId: `long-subject:${line.id}`,
        track: line.track,
        notes: candidateNotes,
        startIndex,
        inverted: bestForm.inverted,
        intervalDistance: bestForm.intervalDistance,
      })
    }
  })

  const exactEntries = matches.filter(
    (match) => match.intervalDistance <= DENSE_SEQUENTIAL_AVERAGE_DISTANCE_LIMIT,
  ).length

  if (
    matches.length < LONG_SUBJECT_MIN_OCCURRENCES ||
    matches.length > MAX_OCCURRENCES_PER_GROUP ||
    exactEntries < LONG_SUBJECT_MIN_EXACT_ENTRIES
  ) {
    return null
  }

  const averageDistance =
    matches.reduce((sum, match) => sum + match.intervalDistance, 0) /
    Math.max(matches.length, 1)

  return {
    noteCount: seed.length,
    confidence: clamp(1 - averageDistance / 3.5, 0.76, 0.98),
    entryOccurrences: matches.length,
    openingOccurrences: 1,
    earliestEntryStart: seed[0]?.start ?? 0,
    occurrences: matches
      .map<MotifOccurrence>((match) => ({
        id: `long-subject:${match.lineId}:${match.startIndex}`,
        track: match.track,
        lineId: match.lineId,
        noteIds: match.notes.map((note) => note.id),
        start: match.notes[0]?.start ?? 0,
        end: Math.max(...match.notes.map((note) => note.end)),
        form: match.inverted ? 'inversion' : 'direct',
      }))
      .sort((left, right) => left.start - right.start || left.track - right.track),
  } satisfies MotifCandidate
}

const findExtendedOpeningSubjectCandidate = (notes: MidiNote[]) => {
  const primaryLines = buildMelodicLines(notes)
  const openingLine = [...primaryLines].sort(
    (left, right) =>
      (left.notes[0]?.start ?? Infinity) -
        (right.notes[0]?.start ?? Infinity) ||
      left.track - right.track ||
      left.id.localeCompare(right.id),
  )[0]

  if (
    !openingLine ||
    openingLine.notes.length < EXTENDED_SUBJECT_MIN_NOTE_COUNT
  ) {
    return null
  }

  const lines = [...primaryLines, ...buildMelodicLines(notes, true)]

  const candidates: MotifCandidate[] = []
  const maximumLength = Math.min(
    EXTENDED_SUBJECT_MAX_NOTE_COUNT,
    openingLine.notes.length,
  )

  for (
    let noteCount = EXTENDED_SUBJECT_MIN_NOTE_COUNT;
    noteCount <= maximumLength;
    noteCount += 1
  ) {
    const seed = openingLine.notes.slice(0, noteCount)
    const seedIntervals = motifIntervals(seed)

    if (
      seedIntervals.some(
        (interval) => Math.abs(interval) > MAX_FIGURE_INTERVAL_DISTANCE,
      ) ||
      new Set(seedIntervals.map(directionOf)).size < 2
    ) {
      continue
    }

    const totalDeviationLimit = Math.max(
      2,
      Math.floor(seedIntervals.length * 0.12),
      Math.ceil(seedIntervals.length * 0.5),
    )
    const matches: DenseFugueMatch[] = []

    lines.forEach((line) => {
      for (
        let startIndex = 0;
        startIndex + noteCount <= line.notes.length;
        startIndex += 1
      ) {
        const candidateNotes = line.notes.slice(startIndex, startIndex + noteCount)
        const isContinuous = candidateNotes.slice(1).every((note, index) => {
          const previous = candidateNotes[index]
          const gap = note.start - (previous?.start ?? note.start)
          return gap > 0 && gap <= MAX_EVENT_GAP_SECONDS
        })

        if (!isContinuous) {
          continue
        }

        const bestForm = [false, true]
          .map((inverted) => {
            const totalDeviation = seedIntervals.reduce(
              (sum, expectedInterval, index) => {
                const previous = candidateNotes[index]
                const current = candidateNotes[index + 1]

                if (!previous || !current) {
                  return Number.POSITIVE_INFINITY
                }

                const actualInterval = current.pitch - previous.pitch
                const transformedInterval = inverted
                  ? -expectedInterval
                  : expectedInterval
                const deviation = Math.abs(actualInterval - transformedInterval)

                if (
                  !hasMatchingFugueDirection(actualInterval, transformedInterval) ||
                  deviation > 1
                ) {
                  return Number.POSITIVE_INFINITY
                }

                return sum + deviation
              },
              0,
            )

            return { inverted, totalDeviation }
          })
          .filter(
            (form) =>
              Number.isFinite(form.totalDeviation) &&
              form.totalDeviation <= totalDeviationLimit,
          )
          .sort(
            (left, right) =>
              left.totalDeviation - right.totalDeviation ||
              Number(left.inverted) - Number(right.inverted),
          )[0]

        if (!bestForm) {
          continue
        }

        matches.push({
          lineId: `extended-subject:${line.id}`,
          track: line.track,
          notes: candidateNotes,
          startIndex,
          inverted: bestForm.inverted,
          intervalDistance: bestForm.totalDeviation / seedIntervals.length,
        })
      }
    })

    const directMatches = [...matches.filter((match) => !match.inverted)
      .reduce((byStart, match) => {
        const key = `${match.track}:${match.notes[0]?.start ?? 0}`
        const existing = byStart.get(key)

        if (!existing || match.intervalDistance < existing.intervalDistance) {
          byStart.set(key, match)
        }

        return byStart
      }, new Map<string, DenseFugueMatch>())
      .values()]

    if (
      directMatches.length < EXTENDED_SUBJECT_MIN_OCCURRENCES ||
      directMatches.length > MAX_OCCURRENCES_PER_GROUP
    ) {
      continue
    }

    const averageDistance =
      directMatches.reduce((sum, match) => sum + match.intervalDistance, 0) /
      directMatches.length

    candidates.push({
      noteCount,
      confidence: clamp(1 - averageDistance / 1.5, 0.78, 0.98),
      entryOccurrences: directMatches.length,
      openingOccurrences: 1,
      earliestEntryStart: seed[0]?.start ?? 0,
      occurrences: directMatches
        .map<MotifOccurrence>((match) => ({
          id: `extended-subject:${match.lineId}:${match.startIndex}`,
          track: match.track,
          lineId: match.lineId,
          noteIds: match.notes.map((note) => note.id),
          start: match.notes[0]?.start ?? 0,
          end: Math.max(...match.notes.map((note) => note.end)),
          form: 'direct',
        }))
        .sort((left, right) => left.start - right.start || left.track - right.track),
    })
  }

  return candidates.sort(
    (left, right) =>
      right.occurrences.length - left.occurrences.length ||
      right.noteCount - left.noteCount,
  )[0] ?? null
}

const findFullOpeningSubjectCandidate = (notes: MidiNote[]) => {
  const trackGroups = buildTrackOnsetGroups(notes)
  const openingTrack = [...trackGroups]
    .filter(({ groups }) => groups.length >= FULL_OPENING_SUBJECT_MIN_NOTE_COUNT)
    .sort(
      (left, right) =>
        (left.groups[0]?.[0]?.start ?? Infinity) -
          (right.groups[0]?.[0]?.start ?? Infinity) ||
        left.track - right.track,
    )[0]

  if (!openingTrack) {
    return null
  }

  const maximumLength = Math.min(
    FULL_OPENING_SUBJECT_MAX_NOTE_COUNT,
    openingTrack.groups.length,
  )

  for (
    let noteCount = maximumLength;
    noteCount >= FULL_OPENING_SUBJECT_MIN_NOTE_COUNT;
    noteCount -= 1
  ) {
    const seed = buildFugueSubjectSeed(
      openingTrack.groups.slice(0, noteCount),
    )

    if (!seed) {
      continue
    }

    const matches = collectFugueSubjectMatches(
      trackGroups,
      seed,
      FULL_OPENING_SUBJECT_MAX_INTERVAL_DEVIATION,
    ).filter(
      (match) =>
        match.intervalDistance <=
        Math.max(2, (noteCount - 1) * 0.08),
    )
    const exactEntries = matches.filter(
      (match) => match.intervalDistance <= 0.001,
    ).length

    if (
      matches.length < FULL_OPENING_SUBJECT_MIN_OCCURRENCES ||
      matches.length > MAX_OCCURRENCES_PER_GROUP ||
      exactEntries < FULL_OPENING_SUBJECT_MIN_EXACT_ENTRIES
    ) {
      continue
    }

    const averageDistance =
      matches.reduce((sum, match) => sum + match.intervalDistance, 0) /
      Math.max(matches.length * (noteCount - 1), 1)

    return {
      noteCount,
      confidence: clamp(1 - averageDistance / 0.5, 0.84, 0.99),
      entryOccurrences: matches.length,
      openingOccurrences: 1,
      earliestEntryStart: seed.notes[0]?.start ?? 0,
      occurrences: matches
        .map<MotifOccurrence>((match) => ({
          id: `full-opening-subject:${match.lineId}:${match.startIndex}`,
          track: match.track,
          lineId: match.lineId ?? `track:${match.track}`,
          noteIds: match.notes.map((note) => note.id),
          start: match.notes[0]?.start ?? 0,
          end: Math.max(...match.notes.map((note) => note.end)),
          form: 'direct',
        }))
        .sort((left, right) => left.start - right.start || left.track - right.track),
    } satisfies MotifCandidate
  }

  return null
}

const findOpeningFigureCandidate = (notes: MidiNote[]) => {
  const trackGroups = buildTrackOnsetGroups(notes)
  const seed = findOpeningFigureSeed(trackGroups)

  if (!seed) {
    return null
  }

  const matches: Array<{
    track: number
    startIndex: number
    notes: MidiNote[]
    intervalDistance: number
  }> = []

  trackGroups.forEach(({ track, groups }) => {
    for (
      let startIndex = 0;
      startIndex + WINDOW_NOTE_COUNT <= groups.length;
      startIndex += 1
    ) {
      const figureGroups = groups.slice(
        startIndex,
        startIndex + WINDOW_NOTE_COUNT,
      )

      if (figureGroups.some((group) => group.length !== 1)) {
        continue
      }

      const figureNotes = figureGroups.flatMap((group) => group)

      if (!hasComparableFigureRhythm(figureNotes, seed)) {
        continue
      }

      const match = findBestFigurePath(figureGroups, seed)

      if (match) {
        matches.push({
          track,
          startIndex,
          notes: match.notes,
          intervalDistance: match.intervalDistance,
        })
      }
    }
  })

  if (matches.length < 8) {
    return null
  }

  const averageDistance =
    matches.reduce((sum, match) => sum + match.intervalDistance, 0) /
    matches.length
  const occurrences = matches
    .map<MotifOccurrence>((match) => ({
      id: `opening-figure:${match.track}:${match.startIndex}`,
      track: match.track,
      lineId: `opening-figure:${match.track}`,
      noteIds: match.notes.map((note) => note.id),
      start: match.notes[0]?.start ?? 0,
      end: Math.max(...match.notes.map((note) => note.end)),
    }))
    .sort((left, right) => left.start - right.start || left.track - right.track)

  return {
    noteCount: WINDOW_NOTE_COUNT,
    confidence: clamp(1 - averageDistance / 40, 0.78, 0.97),
    entryOccurrences: occurrences.length,
    openingOccurrences: 1,
    earliestEntryStart: seed.notes[0]?.start ?? 0,
    occurrences,
  } satisfies MotifCandidate
}

const occurrencesOverlap = (left: MotifOccurrence, right: MotifOccurrence) => {
  if (left.track !== right.track) {
    return false
  }

  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start))
  const shorter = Math.max(Math.min(left.end - left.start, right.end - right.start), 0.001)

  return overlap / shorter > 0.62
}

const isRedundant = (candidate: MotifCandidate, selected: MotifCandidate[]) =>
  selected.some((group) => {
    const overlappingOccurrences = candidate.occurrences.filter((occurrence) =>
      group.occurrences.some((existing) => occurrencesOverlap(occurrence, existing)),
    ).length

    const candidateCoverage =
      overlappingOccurrences / Math.max(candidate.occurrences.length, 1)
    const selectedCoverage =
      overlappingOccurrences / Math.max(group.occurrences.length, 1)

    return candidateCoverage >= 0.7 || selectedCoverage >= 0.78
  })

const findMotifGroupsInternal = (notes: MidiNote[]): MotifGroup[] => {
  const fourPartExpositionCandidate = findFourPartExpositionCandidate(notes)
  const fugueSubjectCandidate = expandFourPartMotifVariants(
    notes,
    mergeOpeningExposition(
      findFugueSubjectCandidate(notes),
      fourPartExpositionCandidate,
    ),
    fourPartExpositionCandidate !== null,
  )
  const denseFugueCandidate = findDenseFugueCandidate(notes)
  const longSubjectCandidate = findLongSubjectTransformCandidate(notes)
  const extendedSubjectCandidate = findExtendedOpeningSubjectCandidate(notes)
  const fullOpeningSubjectCandidate = findFullOpeningSubjectCandidate(notes)
  const baselineOccurrenceCount = fugueSubjectCandidate?.occurrences.length ?? 0
  const maximumConcurrentNotes = Math.max(
    0,
    ...groupOnsets(
      [...notes].sort(
        (left, right) =>
          left.start - right.start || left.pitch - right.pitch || left.end - right.end,
      ),
    ).map((group) => group.length),
  )
  const denseCandidateIsStronger =
    denseFugueCandidate !== null &&
    baselineOccurrenceCount < 20 &&
    denseFugueCandidate.noteCount >= 5 &&
    (denseFugueCandidate.occurrences.length >= 30 ||
      maximumConcurrentNotes >= 5) &&
    denseFugueCandidate.occurrences.length >=
      baselineOccurrenceCount + Math.max(8, baselineOccurrenceCount * 0.5)

  const fullOpeningSubjectCandidateIsStronger =
    fullOpeningSubjectCandidate !== null &&
    denseFugueCandidate !== null &&
    denseFugueCandidate.occurrences.length >= 12 &&
    fullOpeningSubjectCandidate.noteCount >=
      denseFugueCandidate.noteCount * 4

  if (
    fullOpeningSubjectCandidateIsStronger &&
    fullOpeningSubjectCandidate
  ) {
    return [
      {
        id: 'motif-1',
        styleIndex: 0,
        noteCount: fullOpeningSubjectCandidate.noteCount,
        confidence: fullOpeningSubjectCandidate.confidence,
        occurrences: fullOpeningSubjectCandidate.occurrences,
      },
    ]
  }

  if (denseCandidateIsStronger && denseFugueCandidate) {
    return [
      {
        id: 'motif-1',
        styleIndex: 0,
        noteCount: denseFugueCandidate.noteCount,
        confidence: denseFugueCandidate.confidence,
        occurrences: denseFugueCandidate.occurrences,
      },
    ]
  }

  const longSubjectSpans =
    longSubjectCandidate?.occurrences.map(
      (occurrence) => occurrence.end - occurrence.start,
    ) ?? []
  const longSubjectMedianSpan = median(longSubjectSpans)
  const longSubjectHasAugmentation =
    longSubjectSpans.filter(
      (span) => span >= longSubjectMedianSpan * 1.75,
    ).length >= 2
  const longSubjectCandidateIsStronger =
    longSubjectCandidate !== null &&
    baselineOccurrenceCount <= 8 &&
    longSubjectHasAugmentation &&
    longSubjectCandidate.occurrences.length >=
      baselineOccurrenceCount + Math.max(6, baselineOccurrenceCount * 0.5)

  if (longSubjectCandidateIsStronger && longSubjectCandidate) {
    return [
      {
        id: 'motif-1',
        styleIndex: 0,
        noteCount: longSubjectCandidate.noteCount,
        confidence: longSubjectCandidate.confidence,
        occurrences: longSubjectCandidate.occurrences,
      },
    ]
  }

  if (
    extendedSubjectCandidate &&
    extendedSubjectCandidate.occurrences.length >= baselineOccurrenceCount + 1
  ) {
    return [
      {
        id: 'motif-1',
        styleIndex: 0,
        noteCount: extendedSubjectCandidate.noteCount,
        confidence: extendedSubjectCandidate.confidence,
        occurrences: extendedSubjectCandidate.occurrences,
      },
    ]
  }

  if (fugueSubjectCandidate) {
    return [
      {
        id: 'motif-1',
        styleIndex: 0,
        noteCount: fugueSubjectCandidate.noteCount,
        confidence: fugueSubjectCandidate.confidence,
        occurrences: fugueSubjectCandidate.occurrences,
      },
    ]
  }

  const lines = buildMelodicLines(notes)
  const lineMap = new Map(lines.map((line) => [line.id, line]))
  const entryIndexes = buildEntryIndexes(lines)
  const windows = buildWindows(lines)

  if (windows.length < 2) {
    return []
  }

  const buckets = new Map<string, MotifWindow[]>()

  windows.forEach((window) => {
    const bucket = buckets.get(window.key)

    if (bucket) {
      bucket.push(window)
      return
    }

    buckets.set(window.key, [window])
  })

  const seedPairs: MatchPair[] = []

  buckets.forEach((bucket) => {
    if (bucket.length < 2 || bucket.length > MAX_BUCKET_SIZE) {
      return
    }

    for (let leftIndex = 0; leftIndex < bucket.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = bucket[leftIndex]
        const right = bucket[rightIndex]

        if (!left || !right) {
          continue
        }

        const leftIsEntry =
          entryIndexes.get(left.lineId)?.has(left.startIndex) ?? false
        const rightIsEntry =
          entryIndexes.get(right.lineId)?.has(right.startIndex) ?? false

        if (!leftIsEntry && !rightIsEntry) {
          continue
        }

        const score = scoreWindowMatch(left, right)

        if (score <= 0) {
          continue
        }

        seedPairs.push({ left: left.id, right: right.id, score })
      }
    }
  })

  const extendedByKey = new Map<string, ExtendedMatch>()

  seedPairs.forEach((pair) => {
    const left = windows[pair.left]
    const right = windows[pair.right]

    if (!left || !right) {
      return
    }

    const lockStart =
      entryIndexes.get(left.lineId)?.has(left.startIndex) === true ||
      entryIndexes.get(right.lineId)?.has(right.startIndex) === true
    const extended = extendMotifMatch(
      left,
      right,
      pair.score,
      lineMap,
      lockStart,
    )

    if (!extended) {
      return
    }

    const key = [rangeKey(extended.left), rangeKey(extended.right)]
      .sort()
      .join('|')
    const previous = extendedByKey.get(key)

    if (!previous || extended.confidence > previous.confidence) {
      extendedByKey.set(key, extended)
    }
  })

  const extendedMatches = [...extendedByKey.values()]
    .sort((left, right) => {
      const leftLength =
        left.left.endIndex - left.left.startIndex +
        left.right.endIndex -
        left.right.startIndex
      const rightLength =
        right.left.endIndex - right.left.startIndex +
        right.right.endIndex - right.right.startIndex

      return rightLength - leftLength || right.confidence - left.confidence
    })
    .slice(0, 640)

  const nodes: RangeNode[] = []
  const nodeByRange = new Map<string, RangeNode>()
  const nodeFor = (range: LineRange) => {
    const key = rangeKey(range)
    const existing = nodeByRange.get(key)

    if (existing) {
      return existing
    }

    const node: RangeNode = { ...range, id: nodes.length }
    nodes.push(node)
    nodeByRange.set(key, node)
    return node
  }
  const matchedNodes = extendedMatches.map((match) => ({
    left: nodeFor(match.left),
    right: nodeFor(match.right),
    confidence: match.confidence,
  }))
  const sets = createDisjointSet(nodes.length)

  matchedNodes.forEach((match) => {
    sets.union(match.left.id, match.right.id)
  })

  const components = new Map<number, RangeNode[]>()

  nodes.forEach((node) => {
    const root = sets.find(node.id)
    const members = components.get(root)

    if (members) {
      members.push(node)
      return
    }

    components.set(root, [node])
  })

  const pairScores = new Map<number, number[]>()

  matchedNodes.forEach((match) => {
    const root = sets.find(match.left.id)
    const scores = pairScores.get(root)

    if (scores) {
      scores.push(match.confidence)
      return
    }

    pairScores.set(root, [match.confidence])
  })

  const candidates: MotifCandidate[] = []

  components.forEach((members, root) => {
    if (members.length < 2) {
      return
    }

    const occurrences = buildOccurrences(members, lineMap)

    if (occurrences.length < 2) {
      return
    }

    const scores = pairScores.get(root) ?? []
    const confidence =
      scores.reduce((sum, score) => sum + score, 0) / Math.max(scores.length, 1)
    const noteCount = Math.max(
      ...occurrences.map((occurrence) => occurrence.noteIds.length),
    )
    const entryNodes = members.filter(
      (member) => entryIndexes.get(member.lineId)?.has(member.startIndex),
    )
    const openingNodes = members.filter((member) => member.startIndex === 0)

    if (
      noteCount < WINDOW_NOTE_COUNT ||
      entryNodes.length === 0 ||
      openingNodes.length === 0
    ) {
      return
    }

    const earliestEntryStart = Math.min(
      ...entryNodes.map(
        (member) => lineMap.get(member.lineId)?.notes[member.startIndex]?.start ?? Infinity,
      ),
    )

    candidates.push({
      noteCount,
      confidence,
      entryOccurrences: entryNodes.length,
      openingOccurrences: openingNodes.length,
      earliestEntryStart,
      occurrences,
    })
  })

  const openingFigureCandidate = findOpeningFigureCandidate(notes)

  if (openingFigureCandidate) {
    candidates.push(openingFigureCandidate)
  }

  const selected: MotifCandidate[] = []

  candidates
    .sort((left, right) => {
      const leftTracks = new Set(left.occurrences.map((occurrence) => occurrence.track)).size
      const rightTracks = new Set(right.occurrences.map((occurrence) => occurrence.track)).size
      const leftScore =
        left.confidence * 100 +
        Math.min(left.noteCount, 24) * 4 +
        Math.min(left.occurrences.length, 12) * 4 +
        Math.min(left.entryOccurrences, 6) * 5 +
        Math.min(left.openingOccurrences, 3) * 60 -
        Math.min(left.earliestEntryStart, 45) * 0.15 +
        leftTracks * 2
      const rightScore =
        right.confidence * 100 +
        Math.min(right.noteCount, 24) * 4 +
        Math.min(right.occurrences.length, 12) * 4 +
        Math.min(right.entryOccurrences, 6) * 5 +
        Math.min(right.openingOccurrences, 3) * 60 -
        Math.min(right.earliestEntryStart, 45) * 0.15 +
        rightTracks * 2

      return rightScore - leftScore
    })
    .forEach((candidate) => {
      if (selected.length >= MAX_MOTIF_GROUPS || isRedundant(candidate, selected)) {
        return
      }

      selected.push({
        ...candidate,
        occurrences: candidate.occurrences.slice(0, MAX_OCCURRENCES_PER_GROUP),
      })
    })

  return selected.map((candidate, index) => ({
    id: `motif-${index + 1}`,
    styleIndex: index,
    noteCount: candidate.noteCount,
    confidence: candidate.confidence,
    occurrences: candidate.occurrences,
  }))
}

export const findMotifGroups = (notes: MidiNote[]): MotifGroup[] => {
  if (notes.length === 0) {
    return []
  }

  const timeScale = analysisTimeScale(notes)
  const analysisNotes = notes.map((note) => ({
    ...note,
    start: note.start * timeScale,
    duration: note.duration * timeScale,
    end: note.end * timeScale,
  }))
  const groups = findMotifGroupsInternal(analysisNotes)
  const noteById = new Map(analysisNotes.map((note) => [note.id, note]))

  return groups.map((group) => ({
    ...group,
    occurrences: classifyMotifOccurrences(group.occurrences, noteById).map(
      (occurrence) => ({
        ...occurrence,
        start: occurrence.start / timeScale,
        end: occurrence.end / timeScale,
      }),
    ),
  }))
}
