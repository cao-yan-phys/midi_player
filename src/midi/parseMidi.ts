import { Midi } from '@tonejs/midi'
import type { MidiNote, ParsedMidi, TrackRole, TrackSummary } from './noteTypes'

interface TrackDraft {
  track: number
  name: string
  notes: Omit<MidiNote, 'role'>[]
  averagePitch: number
}

const getTrackRole = (
  track: number,
  melodyTrack: number | null,
  bassTrack: number | null,
): TrackRole => {
  if (track === melodyTrack) {
    return 'melody'
  }

  if (track === bassTrack) {
    return 'bass'
  }

  return 'inner'
}

const getTrackName = (
  index: number,
  name: string | undefined,
  instrument: string | undefined,
) => {
  if (name && name.trim().length > 0) {
    return name.trim()
  }

  if (instrument && instrument.trim().length > 0) {
    return instrument.trim()
  }

  return `Track ${index + 1}`
}

export const parseMidi = async (
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParsedMidi> => {
  const midi = new Midi(buffer)
  const drafts: TrackDraft[] = []
  let minPitch = Number.POSITIVE_INFINITY
  let maxPitch = Number.NEGATIVE_INFINITY

  midi.tracks.forEach((track, trackIndex) => {
    if (track.notes.length === 0) {
      return
    }

    const trackName = getTrackName(
      trackIndex,
      track.name,
      track.instrument?.name,
    )

    const notes = track.notes
      .filter((note) => note.duration > 0)
      .map((note, noteIndex) => {
        minPitch = Math.min(minPitch, note.midi)
        maxPitch = Math.max(maxPitch, note.midi)

        return {
          id: `${trackIndex}-${noteIndex}-${note.time.toFixed(4)}`,
          pitch: note.midi,
          start: note.time,
          duration: note.duration,
          velocity: note.velocity,
          track: trackIndex,
          trackName,
          end: note.time + note.duration,
        }
      })

    if (notes.length === 0) {
      return
    }

    const averagePitch =
      notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length

    drafts.push({
      track: trackIndex,
      name: trackName,
      notes,
      averagePitch,
    })
  })

  if (drafts.length === 0) {
    throw new Error('No playable notes were found in this MIDI file.')
  }

  const byAveragePitch = [...drafts].sort(
    (a, b) => a.averagePitch - b.averagePitch,
  )
  const bassTrack =
    byAveragePitch.length > 1 ? byAveragePitch[0]?.track ?? null : null
  const melodyTrack = byAveragePitch.at(-1)?.track ?? null

  const tracks: TrackSummary[] = drafts.map((draft) => ({
    track: draft.track,
    name: draft.name,
    noteCount: draft.notes.length,
    averagePitch: draft.averagePitch,
    role: getTrackRole(draft.track, melodyTrack, bassTrack),
  }))

  const notes: MidiNote[] = drafts
    .flatMap((draft) =>
      draft.notes.map((note) => ({
        ...note,
        role: getTrackRole(note.track, melodyTrack, bassTrack),
      })),
    )
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch)

  const duration =
    notes.reduce((latest, note) => Math.max(latest, note.end), 0) ||
    midi.duration

  return {
    fileName,
    name: midi.name || fileName.replace(/\.(mid|midi)$/i, ''),
    duration,
    notes,
    tracks,
    pitchRange: {
      min: Number.isFinite(minPitch) ? minPitch : 48,
      max: Number.isFinite(maxPitch) ? maxPitch : 72,
    },
  }
}
