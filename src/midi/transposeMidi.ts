import type { MidiNote, ParsedMidi } from './noteTypes'

export const MIN_TRANSPOSE = -24
export const MAX_TRANSPOSE = 24

const MIDI_MIN = 0
const MIDI_MAX = 127

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const clampTranspose = (semitones: number) =>
  Math.trunc(
    clamp(Number.isFinite(semitones) ? semitones : 0, MIN_TRANSPOSE, MAX_TRANSPOSE),
  )

const transposePitch = (pitch: number, semitones: number) =>
  clamp(pitch + semitones, MIDI_MIN, MIDI_MAX)

const getPitchRange = (notes: MidiNote[]) =>
  notes.reduce(
    (range, note) => ({
      min: Math.min(range.min, note.pitch),
      max: Math.max(range.max, note.pitch),
    }),
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  )

export const transposeMidi = (
  midi: ParsedMidi,
  semitones: number,
): ParsedMidi => {
  const safeSemitones = clampTranspose(semitones)

  if (safeSemitones === 0) {
    return midi
  }

  const notes = midi.notes.map((note) => ({
    ...note,
    pitch: transposePitch(note.pitch, safeSemitones),
  }))
  const pitchesByTrack = new Map<number, number[]>()

  notes.forEach((note) => {
    const pitches = pitchesByTrack.get(note.track)

    if (pitches) {
      pitches.push(note.pitch)
      return
    }

    pitchesByTrack.set(note.track, [note.pitch])
  })

  const tracks = midi.tracks.map((track) => {
    const pitches = pitchesByTrack.get(track.track)

    if (!pitches || pitches.length === 0) {
      return track
    }

    return {
      ...track,
      averagePitch:
        pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length,
    }
  })
  const pitchRange = getPitchRange(notes)

  return {
    ...midi,
    notes,
    tracks,
    pitchRange: {
      min: Number.isFinite(pitchRange.min) ? pitchRange.min : midi.pitchRange.min,
      max: Number.isFinite(pitchRange.max) ? pitchRange.max : midi.pitchRange.max,
    },
  }
}
