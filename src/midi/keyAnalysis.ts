import type { MidiNote } from './noteTypes'

export interface LocalKeyAnalysis {
  label: string
  start: number
  end: number
}

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
]

const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
]

const TONIC_NAMES = [
  'C',
  'D-flat',
  'D',
  'E-flat',
  'E',
  'F',
  'F-sharp',
  'G',
  'A-flat',
  'A',
  'B-flat',
  'B',
]

const LOCAL_WINDOW_SECONDS = 8

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const correlation = (left: number[], right: number[]) => {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  let numerator = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = (left[index] ?? 0) - leftMean
    const rightDelta = (right[index] ?? 0) - rightMean
    numerator += leftDelta * rightDelta
    leftMagnitude += leftDelta * leftDelta
    rightMagnitude += rightDelta * rightDelta
  }

  if (leftMagnitude <= 0 || rightMagnitude <= 0) {
    return Number.NEGATIVE_INFINITY
  }

  return numerator / Math.sqrt(leftMagnitude * rightMagnitude)
}

const keyProfileFor = (tonic: number, profile: number[]) =>
  Array.from({ length: 12 }, (_, pitchClass) =>
    profile[(pitchClass - tonic + 12) % 12] ?? 0,
  )

export const analyzeLocalKey = (
  notes: MidiNote[],
  currentTime: number,
  duration: number,
): LocalKeyAnalysis | null => {
  if (notes.length === 0 || duration <= 0) {
    return null
  }

  const center = clamp(currentTime, 0, duration)
  const windowLength = Math.min(LOCAL_WINDOW_SECONDS, duration)
  const start = clamp(
    center - windowLength / 2,
    0,
    Math.max(duration - windowLength, 0),
  )
  const end = start + windowLength
  const pitchClassWeights = Array.from({ length: 12 }, () => 0)

  notes.forEach((note) => {
    const overlap = Math.max(0, Math.min(note.end, end) - Math.max(note.start, start))

    if (overlap <= 0) {
      return
    }

    const noteCenter = (Math.max(note.start, start) + Math.min(note.end, end)) / 2
    const distance = Math.abs(noteCenter - center)
    const proximity =
      1 - clamp(distance / Math.max(windowLength / 2, 0.01), 0, 1) * 0.35
    const velocityWeight = 0.72 + clamp(note.velocity, 0, 1) * 0.28
    const weight = Math.sqrt(overlap) * proximity * velocityWeight
    const pitchClass = ((note.pitch % 12) + 12) % 12

    pitchClassWeights[pitchClass] += weight
  })

  if (pitchClassWeights.every((weight) => weight <= 0)) {
    return null
  }

  let bestTonic = 0
  let bestMode: 'major' | 'minor' = 'major'
  let bestScore = Number.NEGATIVE_INFINITY

  for (let tonic = 0; tonic < 12; tonic += 1) {
    const majorScore = correlation(pitchClassWeights, keyProfileFor(tonic, MAJOR_PROFILE))

    if (majorScore > bestScore) {
      bestTonic = tonic
      bestMode = 'major'
      bestScore = majorScore
    }

    const minorScore = correlation(pitchClassWeights, keyProfileFor(tonic, MINOR_PROFILE))

    if (minorScore > bestScore) {
      bestTonic = tonic
      bestMode = 'minor'
      bestScore = minorScore
    }
  }

  return {
    label: `${TONIC_NAMES[bestTonic] ?? 'C'} ${bestMode}`,
    start,
    end,
  }
}
