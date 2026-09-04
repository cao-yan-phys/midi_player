export type TrackRole = 'melody' | 'bass' | 'inner'

export interface MidiNote {
  id: string
  pitch: number
  start: number
  duration: number
  velocity: number
  track: number
  trackName: string
  role: TrackRole
  end: number
}

export interface TrackSummary {
  track: number
  name: string
  noteCount: number
  averagePitch: number
  role: TrackRole
}

export interface PitchRange {
  min: number
  max: number
}

export interface GwWaveformSeries {
  track: number
  name: string
  role: TrackRole
  values: number[]
}

export interface GwWaveform {
  sampleCount: number
  valueMin: number
  valueMax: number
  series: GwWaveformSeries[]
}

export interface ParsedMidi {
  fileName: string
  name: string
  duration: number
  notes: MidiNote[]
  tracks: TrackSummary[]
  pitchRange: PitchRange
  visualSeed?: number
  gwWaveform?: GwWaveform
}
