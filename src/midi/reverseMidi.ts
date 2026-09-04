import type { MidiNote, ParsedMidi } from './noteTypes'

const byStartTime = (left: MidiNote, right: MidiNote) =>
  left.start - right.start || left.track - right.track || left.pitch - right.pitch

export const reverseMidi = (midi: ParsedMidi): ParsedMidi => {
  const notes = midi.notes
    .map((note) => {
      const start = Math.max(0, midi.duration - note.end)

      return {
        ...note,
        start,
        end: start + note.duration,
      }
    })
    .sort(byStartTime)

  return {
    ...midi,
    notes,
    gwWaveform: midi.gwWaveform
      ? {
          ...midi.gwWaveform,
          series: midi.gwWaveform.series.map((series) => ({
            ...series,
            values: [...series.values].reverse(),
          })),
        }
      : undefined,
  }
}
