import type { MidiNote, ParsedMidi, TrackRole, TrackSummary } from './noteTypes'

interface ComplexSample {
  re: number
  im: number
}

interface NoteDraft {
  pitch: number
  start: number
  duration: number
  velocity: number
}

const OUTPUT_DURATION = 90
const MIN_PITCH = 42
const MAX_PITCH = 84
const CROSS_INTERVAL = 7
const MIN_NOTES = 140
const MAX_NOTES = 720

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const mean = (values: number[], start: number, end: number) => {
  let sum = 0
  let count = 0

  for (let index = start; index < end; index += 1) {
    sum += values[index]
    count += 1
  }

  return count > 0 ? sum / count : 0
}

const quantile = (values: number[], q: number) => {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp((sorted.length - 1) * q, 0, sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const ratio = index - lower

  return sorted[lower] * (1 - ratio) + sorted[upper] * ratio
}

const movingAverage = (values: number[], radius: number) => {
  if (radius <= 0) {
    return values
  }

  return values.map((_, index) => {
    const start = Math.max(0, index - radius)
    const end = Math.min(values.length, index + radius + 1)
    return mean(values, start, end)
  })
}

const splitCsvLine = (line: string) => {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted
      continue
    }

    if (char === ',' && !quoted) {
      cells.push(cell)
      cell = ''
      continue
    }

    cell += char
  }

  cells.push(cell)
  return cells
}

const parseImaginaryCoefficient = (text: string) => {
  if (text === '' || text === '+') {
    return 1
  }

  if (text === '-') {
    return -1
  }

  return Number(text)
}

const findComplexSplit = (text: string) => {
  for (let index = text.length - 1; index > 0; index -= 1) {
    const char = text[index]
    const previous = text[index - 1]

    if ((char === '+' || char === '-') && previous !== 'e' && previous !== 'E') {
      return index
    }
  }

  return -1
}

const parseComplex = (cell: string): ComplexSample | null => {
  const normalized = cell
    .trim()
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .replace(/\s+/g, '')
    .replace(/\u2212/g, '-')
    .replace(/I/g, 'j')
    .replace(/i/g, 'j')

  if (!normalized || normalized.toLowerCase() === 'nan') {
    return null
  }

  if (!normalized.endsWith('j')) {
    const real = Number(normalized)
    return Number.isFinite(real) ? { re: real, im: 0 } : null
  }

  const body = normalized.slice(0, -1)
  const split = findComplexSplit(body)

  if (split === -1) {
    const imaginary = parseImaginaryCoefficient(body)
    return Number.isFinite(imaginary) ? { re: 0, im: imaginary } : null
  }

  const real = Number(body.slice(0, split))
  const imaginary = parseImaginaryCoefficient(body.slice(split))

  if (!Number.isFinite(real) || !Number.isFinite(imaginary)) {
    return null
  }

  return { re: real, im: imaginary }
}

const looksLikeRowIndex = (cell: string) => /^\s*\d+\s*$/.test(cell)

const hasImaginaryUnit = (cell: string) => /[ij]\s*\)?\s*$/i.test(cell)

const parseComplexSamples = (text: string) => {
  const samples: ComplexSample[] = []

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      return
    }

    const cells = splitCsvLine(line).map((cell) => cell.trim())
    const sampleCells =
      cells.length > 1 && looksLikeRowIndex(cells[0]) && cells.slice(1).some(hasImaginaryUnit)
        ? cells.slice(1)
        : cells

    sampleCells.forEach((cell) => {
      const sample = parseComplex(cell)

      if (sample) {
        samples.push(sample)
      }
    })
  })

  return samples.filter(
    (sample) => Number.isFinite(sample.re) && Number.isFinite(sample.im),
  )
}

const unwrapPhase = (phases: number[]) => {
  if (phases.length === 0) {
    return []
  }

  const unwrapped = [phases[0]]

  for (let index = 1; index < phases.length; index += 1) {
    let delta = phases[index] - phases[index - 1]

    while (delta > Math.PI) {
      delta -= Math.PI * 2
    }

    while (delta < -Math.PI) {
      delta += Math.PI * 2
    }

    unwrapped.push(unwrapped[index - 1] + delta)
  }

  return unwrapped
}

const getFrequencyProxy = (samples: ComplexSample[]) => {
  const phases = unwrapPhase(samples.map((sample) => Math.atan2(sample.im, sample.re)))

  return phases.map((phase, index) => {
    if (index === 0) {
      return Math.abs(phases[1] - phase)
    }

    if (index === phases.length - 1) {
      return Math.abs(phase - phases[index - 1])
    }

    return Math.abs(phases[index + 1] - phases[index - 1]) * 0.5
  })
}

const normalizeLog = (values: number[]) => {
  const positive = values.filter((value) => value > 0 && Number.isFinite(value))
  const floor = Math.max(quantile(positive, 0.05), Number.EPSILON)
  const ceiling = Math.max(quantile(positive, 0.95), floor * 1.0001)
  const logFloor = Math.log(floor)
  const logCeiling = Math.log(ceiling)
  const span = Math.max(logCeiling - logFloor, Number.EPSILON)

  return values.map((value) =>
    clamp((Math.log(Math.max(value, floor)) - logFloor) / span, 0, 1),
  )
}

const normalizeLinear = (values: number[]) => {
  const ceiling = Math.max(quantile(values, 0.98), Number.EPSILON)

  return values.map((value) => clamp(value / ceiling, 0, 1))
}

const createTrackNotes = (
  drafts: NoteDraft[],
  track: number,
  trackName: string,
  role: TrackRole,
) =>
  drafts.map((draft, index) => ({
    id: `${track}-${index}-${draft.start.toFixed(4)}`,
    pitch: draft.pitch,
    start: draft.start,
    duration: draft.duration,
    velocity: draft.velocity,
    track,
    trackName,
    role,
    end: draft.start + draft.duration,
  }))

const createDrafts = (
  pitches: number[],
  velocities: number[],
  pitchOffset: number,
  sampleCount: number,
) => {
  const targetNotes = Math.round(clamp(Math.sqrt(sampleCount) * 12, MIN_NOTES, MAX_NOTES))
  const samplesPerNote = sampleCount / targetNotes
  const secondsPerSample = OUTPUT_DURATION / sampleCount
  const drafts: NoteDraft[] = []

  for (let noteIndex = 0; noteIndex < targetNotes; noteIndex += 1) {
    const startSample = Math.floor(noteIndex * samplesPerNote)
    const endSample = Math.min(
      sampleCount,
      Math.max(startSample + 1, Math.floor((noteIndex + 1) * samplesPerNote)),
    )
    const start = startSample * secondsPerSample
    const duration = Math.max(0.045, (endSample - startSample) * secondsPerSample * 0.96)
    const pitch = Math.round(
      clamp(mean(pitches, startSample, endSample) + pitchOffset, 24, 108),
    )
    const velocity = clamp(0.12 + mean(velocities, startSample, endSample) * 0.86, 0.05, 1)

    if (velocity < 0.08) {
      continue
    }

    const previous = drafts.at(-1)

    if (
      previous &&
      previous.pitch === pitch &&
      Math.abs(previous.velocity - velocity) < 0.08 &&
      start - (previous.start + previous.duration) < 0.03
    ) {
      previous.duration = start + duration - previous.start
      previous.velocity = (previous.velocity + velocity) * 0.5
      continue
    }

    drafts.push({
      pitch,
      start,
      duration,
      velocity,
    })
  }

  return drafts
}

const getAveragePitch = (notes: MidiNote[]) =>
  notes.reduce((sum, note) => sum + note.pitch, 0) / Math.max(notes.length, 1)

export const parseGwCsv = (
  fileName: string,
  text: string,
): ParsedMidi => {
  const samples = parseComplexSamples(text)

  if (samples.length < 16) {
    throw new Error('GW CSV needs at least 16 complex samples.')
  }

  const hPlus = samples.map((sample) => sample.re)
  const hCross = samples.map((sample) => -sample.im)
  const waveformRange = [...hPlus, ...hCross].reduce(
    (range, value) => ({
      min: Math.min(range.min, value),
      max: Math.max(range.max, value),
    }),
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  )
  const smoothRadius = clamp(Math.floor(samples.length / 1200), 1, 8)
  const frequency = movingAverage(getFrequencyProxy(samples), smoothRadius)
  const pitchContour = normalizeLog(frequency).map((normalized) =>
    MIN_PITCH + normalized * (MAX_PITCH - MIN_PITCH),
  )
  const plusVelocity = normalizeLinear(
    samples.map((_, index) => Math.abs(hPlus[index])),
  )
  const crossVelocity = normalizeLinear(
    samples.map((_, index) => Math.abs(hCross[index])),
  )
  const plusNotes = createTrackNotes(
    createDrafts(pitchContour, plusVelocity, 0, samples.length),
    0,
    'h_plus',
    'melody',
  )
  const crossNotes = createTrackNotes(
    createDrafts(pitchContour, crossVelocity, CROSS_INTERVAL, samples.length),
    1,
    'h_cross',
    'inner',
  )
  const notes = [...plusNotes, ...crossNotes].sort(
    (a, b) => a.start - b.start || a.track - b.track,
  )
  const tracks: TrackSummary[] = [
    {
      track: 0,
      name: 'h_plus',
      noteCount: plusNotes.length,
      averagePitch: getAveragePitch(plusNotes),
      role: 'melody',
    },
    {
      track: 1,
      name: 'h_cross',
      noteCount: crossNotes.length,
      averagePitch: getAveragePitch(crossNotes),
      role: 'inner',
    },
  ]
  const pitchRange = notes.reduce(
    (range, note) => ({
      min: Math.min(range.min, note.pitch),
      max: Math.max(range.max, note.pitch),
    }),
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  )

  return {
    fileName,
    name: fileName.replace(/\.csv$/i, ''),
    duration: OUTPUT_DURATION,
    notes,
    tracks,
    pitchRange: {
      min: Number.isFinite(pitchRange.min) ? pitchRange.min : MIN_PITCH,
      max: Number.isFinite(pitchRange.max) ? pitchRange.max : MAX_PITCH,
    },
    gwWaveform: {
      sampleCount: samples.length,
      valueMin: Number.isFinite(waveformRange.min) ? waveformRange.min : -1,
      valueMax: Number.isFinite(waveformRange.max) ? waveformRange.max : 1,
      series: [
        {
          track: 0,
          name: 'h_plus',
          role: 'melody',
          values: hPlus,
        },
        {
          track: 1,
          name: 'h_cross',
          role: 'inner',
          values: hCross,
        },
      ],
    },
  }
}
