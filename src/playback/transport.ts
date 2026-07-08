import { Piano } from '@tonejs/piano/build/piano/Piano'
import { now as toneNow, start as startTone } from 'tone'
import type { MidiNote } from '../midi/noteTypes'

type TransportState = 'stopped' | 'paused' | 'playing'

export type SoundPreset = 'grandPiano' | 'softSynth' | 'musicBox'
export type PlaybackRate = 0.25 | 0.5 | 1 | 2 | 4

interface Voice {
  sources: AudioScheduledSourceNode[]
  gains: GainNode[]
}

const LOOKAHEAD_SECONDS = 1.35
const SCHEDULER_MS = 55
const SOFT_SYNTH_MASTER_GAIN = 0.5
const MUSIC_BOX_MASTER_GAIN = 2
export const DEFAULT_VOLUME = 0.85
export const MAX_VOLUME = 2
const PIANO_BASE_VOLUME = {
  strings: -7,
  keybed: -18,
  harmonics: -24,
  pedal: -32,
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const midiToFrequency = (pitch: number) =>
  440 * 2 ** ((pitch - 69) / 12)

const volumeToDecibelOffset = (volume: number) =>
  volume <= 0.0001 ? -80 : 20 * Math.log10(volume)

const MUSIC_BOX_BASE_URL =
  'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/music_box-mp3/'
const MUSIC_BOX_MIN_MIDI = 21
const MUSIC_BOX_MAX_MIDI = 108
const MUSIC_BOX_SAMPLE_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
]

export const PLAYBACK_RATES: PlaybackRate[] = [0.25, 0.5, 1, 2, 4]

export const normalizePlaybackRate = (rate: number): PlaybackRate => {
  const closest = PLAYBACK_RATES.reduce((best, candidate) =>
    Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best,
  )

  return closest
}

export class MidiTransport {
  private context: AudioContext | null = null

  private master: GainNode | null = null

  private notes: MidiNote[] = []

  private visibleTracks = new Set<number>()

  private soundPreset: SoundPreset = 'grandPiano'

  private piano: Piano | null = null

  private pianoLoadPromise: Promise<void> | null = null

  private pianoRangeKey = ''

  private musicBoxBuffers = new Map<string, AudioBuffer>()

  private musicBoxLoadPromises = new Map<string, Promise<AudioBuffer | null>>()

  private failedMusicBoxSamples = new Set<string>()

  private duration = 0

  private state: TransportState = 'stopped'

  private position = 0

  private basePosition = 0

  private startedAt = 0

  private playbackRate: PlaybackRate = 1

  private volume = DEFAULT_VOLUME

  private nextNoteIndex = 0

  private schedulerId: number | null = null

  private activeVoices: Voice[] = []

  private readonly onEnded: (time: number) => void

  constructor(onEnded: (time: number) => void) {
    this.onEnded = onEnded
  }

  load(notes: MidiNote[], duration: number, visibleTracks: ReadonlySet<number>) {
    this.stop()
    this.notes = [...notes].sort((a, b) => a.start - b.start)
    this.duration = duration
    this.visibleTracks = new Set(visibleTracks)
    this.position = 0
    this.basePosition = 0
    this.nextNoteIndex = 0
    this.resetPiano()
  }

  setVisibleTracks(visibleTracks: ReadonlySet<number>) {
    this.visibleTracks = new Set(visibleTracks)
  }

  setSoundPreset(soundPreset: SoundPreset) {
    this.soundPreset = soundPreset
    this.applyMasterGain()

    if (soundPreset === 'grandPiano') {
      void this.ensurePianoLoaded()
    }

    if (soundPreset === 'musicBox') {
      void this.ensureMusicBoxLoaded()
    }
  }

  preloadCurrentSound() {
    if (this.soundPreset === 'grandPiano') {
      void this.ensurePianoLoaded()
    }

    if (this.soundPreset === 'musicBox') {
      void this.ensureMusicBoxLoaded()
    }
  }

  setPlaybackRate(playbackRate: PlaybackRate) {
    const nextRate = normalizePlaybackRate(playbackRate)

    if (nextRate === this.playbackRate) {
      return
    }

    const wasPlaying = this.state === 'playing'
    const currentTime = this.getCurrentTime()

    this.playbackRate = nextRate
    this.position = currentTime
    this.basePosition = currentTime
    this.nextNoteIndex = this.findNextNoteIndex(currentTime)

    if (!wasPlaying || !this.context) {
      return
    }

    this.startedAt = this.context.currentTime
    this.clearScheduler()
    this.stopActiveVoices()
    this.tickScheduler()
    this.schedulerId = window.setInterval(() => {
      this.tickScheduler()
    }, SCHEDULER_MS)
  }

  setVolume(volume: number) {
    this.volume = clamp(
      Number.isFinite(volume) ? volume : DEFAULT_VOLUME,
      0,
      MAX_VOLUME,
    )

    if (this.context && this.master) {
      this.applyMasterGain()
    }

    this.applyPianoVolume()
  }

  getCurrentTime() {
    if (this.state !== 'playing' || !this.context) {
      return this.position
    }

    return clamp(
      this.basePosition +
        (this.context.currentTime - this.startedAt) * this.playbackRate,
      0,
      this.duration,
    )
  }

  async play(startAt = this.position) {
    const context = this.ensureContext()
    await context.resume()

    if (this.soundPreset === 'grandPiano') {
      await startTone()
      await this.ensurePianoLoaded()
    }

    if (this.soundPreset === 'musicBox') {
      await this.ensureMusicBoxLoaded()
    }

    this.clearScheduler()
    this.stopActiveVoices()
    this.state = 'playing'
    this.position = clamp(startAt, 0, this.duration)
    this.basePosition = this.position
    this.startedAt = context.currentTime
    this.nextNoteIndex = this.findNextNoteIndex(this.position)
    this.tickScheduler()
    this.schedulerId = window.setInterval(() => {
      this.tickScheduler()
    }, SCHEDULER_MS)
  }

  pause() {
    this.position = this.getCurrentTime()
    this.state = 'paused'
    this.clearScheduler()
    this.stopActiveVoices()
  }

  stop() {
    this.position = 0
    this.basePosition = 0
    this.state = 'stopped'
    this.nextNoteIndex = 0
    this.clearScheduler()
    this.stopActiveVoices()
  }

  seek(time: number) {
    const nextTime = clamp(time, 0, this.duration)

    if (this.state === 'playing') {
      void this.play(nextTime)
      return
    }

    this.position = nextTime
    this.basePosition = nextTime
    this.nextNoteIndex = this.findNextNoteIndex(nextTime)
  }

  private ensureContext() {
    if (this.context) {
      return this.context
    }

    this.context = new AudioContext()
    this.master = this.context.createGain()
    this.master.gain.value = this.getMasterGain()
    this.master.connect(this.context.destination)
    return this.context
  }

  private findNextNoteIndex(time: number) {
    const index = this.notes.findIndex((note) => note.end >= time)
    return index === -1 ? this.notes.length : index
  }

  private tickScheduler() {
    const context = this.context

    if (!context || this.state !== 'playing') {
      return
    }

    const currentTime = this.getCurrentTime()

    if (currentTime >= this.duration) {
      this.finish()
      this.onEnded(this.duration)
      return
    }

    const horizon =
      currentTime +
      (this.soundPreset === 'grandPiano' ? 0.28 : LOOKAHEAD_SECONDS) *
        this.playbackRate

    while (
      this.nextNoteIndex < this.notes.length &&
      this.notes[this.nextNoteIndex].start <= horizon
    ) {
      const note = this.notes[this.nextNoteIndex]

      if (note.end >= currentTime && this.visibleTracks.has(note.track)) {
        this.scheduleNote(note, currentTime, context.currentTime)
      }

      this.nextNoteIndex += 1
    }
  }

  private scheduleNote(
    note: MidiNote,
    playbackTime: number,
    audioTime: number,
  ) {
    const context = this.context
    const master = this.master

    if (!context || !master) {
      return
    }

    if (this.soundPreset === 'musicBox') {
      this.scheduleMusicBoxNote(note, playbackTime, audioTime, context, master)
      return
    }

    if (this.soundPreset === 'grandPiano') {
      this.scheduleGrandPianoNote(note, playbackTime)
      return
    }

    this.scheduleSoftSynthNote(note, playbackTime, audioTime, context, master)
  }

  private getPianoRange() {
    const pitches = this.notes.map((note) => note.pitch)
    const minPitch = pitches.length > 0 ? Math.min(...pitches) : 21
    const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 108
    const minNote = Math.max(21, minPitch - 3)
    const maxNote = Math.min(108, maxPitch + 3)

    return {
      key: `${minNote}-${maxNote}`,
      minNote,
      maxNote,
    }
  }

  private async ensurePianoLoaded() {
    const range = this.getPianoRange()

    if (this.piano?.loaded && this.pianoRangeKey === range.key) {
      return
    }

    if (this.pianoLoadPromise && this.pianoRangeKey === range.key) {
      await this.pianoLoadPromise
      return
    }

    this.resetPiano()
    this.pianoRangeKey = range.key
    this.piano = new Piano({
      velocities: 5,
      minNote: range.minNote,
      maxNote: range.maxNote,
      release: true,
      pedal: false,
      maxPolyphony: 64,
      volume: this.getPianoVolumes(),
    }).toDestination()
    this.applyPianoVolume()
    this.pianoLoadPromise = this.piano.load().finally(() => {
      this.pianoLoadPromise = null
    })

    await this.pianoLoadPromise
  }

  private resetPiano() {
    this.piano?.stopAll()
    this.piano?.dispose()
    this.piano = null
    this.pianoLoadPromise = null
    this.pianoRangeKey = ''
  }

  private getMasterGain() {
    const presetGain =
      this.soundPreset === 'musicBox'
        ? MUSIC_BOX_MASTER_GAIN
        : SOFT_SYNTH_MASTER_GAIN

    return presetGain * this.volume
  }

  private applyMasterGain() {
    if (!this.context || !this.master) {
      return
    }

    const contextTime = this.context.currentTime

    this.master.gain.cancelScheduledValues(contextTime)
    this.master.gain.setTargetAtTime(this.getMasterGain(), contextTime, 0.015)
  }

  private getPianoVolumes() {
    const offset = volumeToDecibelOffset(this.volume)

    return {
      strings: PIANO_BASE_VOLUME.strings + offset,
      keybed: PIANO_BASE_VOLUME.keybed + offset,
      harmonics: PIANO_BASE_VOLUME.harmonics + offset,
      pedal: PIANO_BASE_VOLUME.pedal + offset,
    }
  }

  private applyPianoVolume() {
    if (!this.piano) {
      return
    }

    const volumes = this.getPianoVolumes()

    this.piano.strings.value = volumes.strings
    this.piano.keybed.value = volumes.keybed
    this.piano.harmonics.value = volumes.harmonics
    this.piano.pedal.value = volumes.pedal
  }

  private getMusicBoxSample(pitch: number) {
    const samplePitch = Math.round(
      clamp(pitch, MUSIC_BOX_MIN_MIDI, MUSIC_BOX_MAX_MIDI),
    )
    const noteName = MUSIC_BOX_SAMPLE_NAMES[samplePitch % 12]
    const octave = Math.floor(samplePitch / 12) - 1

    return {
      name: `${noteName}${octave}`,
      playbackRatio: 2 ** ((pitch - samplePitch) / 12),
    }
  }

  private async loadMusicBoxSample(
    sampleName: string,
    context = this.ensureContext(),
  ) {
    const loaded = this.musicBoxBuffers.get(sampleName)

    if (loaded) {
      return loaded
    }

    const pending = this.musicBoxLoadPromises.get(sampleName)

    if (pending) {
      return pending
    }

    const promise = fetch(`${MUSIC_BOX_BASE_URL}${sampleName}.mp3`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load music box sample ${sampleName}.`)
        }

        return response.arrayBuffer()
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .then((buffer) => {
        this.musicBoxBuffers.set(sampleName, buffer)
        this.failedMusicBoxSamples.delete(sampleName)
        return buffer
      })
      .catch(() => {
        this.failedMusicBoxSamples.add(sampleName)
        return null
      })
      .finally(() => {
        this.musicBoxLoadPromises.delete(sampleName)
      })

    this.musicBoxLoadPromises.set(sampleName, promise)
    return promise
  }

  private async ensureMusicBoxLoaded() {
    const context = this.ensureContext()
    const sampleNames = [
      ...new Set(this.notes.map((note) => this.getMusicBoxSample(note.pitch).name)),
    ]

    await Promise.allSettled(
      sampleNames.map((sampleName) =>
        this.loadMusicBoxSample(sampleName, context),
      ),
    )
  }

  private scheduleGrandPianoNote(note: MidiNote, playbackTime: number) {
    if (!this.piano?.loaded) {
      return
    }

    const offset = Math.max(0, note.start - playbackTime) / this.playbackRate
    const startAt = toneNow() + offset
    const heldDuration = Math.max(
      0.08,
      (note.end - Math.max(note.start, playbackTime)) / this.playbackRate,
    )
    const releaseAt = startAt + heldDuration

    this.piano.keyDown({
      midi: note.pitch,
      time: startAt,
      velocity: clamp(note.velocity * 0.92 + 0.08, 0.05, 1),
    })
    this.piano.keyUp({
      midi: note.pitch,
      time: releaseAt,
      velocity: 0.55,
    })
  }

  private scheduleSoftSynthNote(
    note: MidiNote,
    playbackTime: number,
    audioTime: number,
    context: AudioContext,
    master: GainNode,
  ) {
    const startAt =
      audioTime + Math.max(0, note.start - playbackTime) / this.playbackRate
    const audibleDuration = Math.max(
      0.06,
      (note.end - Math.max(note.start, playbackTime)) / this.playbackRate,
    )
    const stopAt = startAt + audibleDuration
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const roleLevel = note.role === 'bass' ? 0.22 : note.role === 'melody' ? 0.16 : 0.1
    const level = roleLevel * (0.35 + note.velocity * 0.65)
    const attack = Math.min(0.035, audibleDuration * 0.2)
    const release = Math.min(0.12, audibleDuration * 0.28)

    oscillator.type = note.role === 'melody' ? 'triangle' : 'sine'
    oscillator.frequency.setValueAtTime(midiToFrequency(note.pitch), startAt)
    gain.gain.setValueAtTime(0.0001, startAt)
    gain.gain.linearRampToValueAtTime(level, startAt + attack)
    gain.gain.setValueAtTime(level, Math.max(startAt + attack, stopAt - release))
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt)

    oscillator.connect(gain)
    gain.connect(master)
    oscillator.start(startAt)
    oscillator.stop(stopAt + 0.02)

    const voice = { sources: [oscillator], gains: [gain] }
    this.activeVoices.push(voice)
    oscillator.onended = () => {
      this.cleanupVoice(voice)
    }
  }

  private scheduleMusicBoxNote(
    note: MidiNote,
    playbackTime: number,
    audioTime: number,
    context: AudioContext,
    master: GainNode,
  ) {
    {
      const sample = this.getMusicBoxSample(note.pitch)
      const buffer = this.musicBoxBuffers.get(sample.name)

      if (buffer) {
        const startAt =
          audioTime + Math.max(0, note.start - playbackTime) / this.playbackRate
        const source = context.createBufferSource()
        const gain = context.createGain()
        const velocityLevel = 0.28 + note.velocity * 0.72
        const roleLevel =
          note.role === 'bass' ? 0.44 : note.role === 'melody' ? 0.52 : 0.42
        const level = roleLevel * velocityLevel
        const naturalDuration = buffer.duration / sample.playbackRatio
        const scaledDuration = note.duration / this.playbackRate
        const stopAt =
          startAt + Math.min(naturalDuration, Math.max(0.65, scaledDuration + 1.8))

        source.buffer = buffer
        source.playbackRate.setValueAtTime(sample.playbackRatio, startAt)
        gain.gain.setValueAtTime(0.0001, startAt)
        gain.gain.linearRampToValueAtTime(level, startAt + 0.008)
        gain.gain.setValueAtTime(level, Math.max(startAt + 0.01, stopAt - 0.08))
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt)
        source.connect(gain)
        gain.connect(master)
        source.start(startAt)
        source.stop(stopAt + 0.03)

        const voice = { sources: [source], gains: [gain] }
        this.activeVoices.push(voice)
        source.onended = () => {
          this.cleanupVoice(voice)
        }
        return
      }

      if (!this.failedMusicBoxSamples.has(sample.name)) {
        void this.loadMusicBoxSample(sample.name, context)
        return
      }
    }

    const startAt =
      audioTime + Math.max(0, note.start - playbackTime) / this.playbackRate
    const frequency = midiToFrequency(note.pitch)
    const scaledDuration = note.duration / this.playbackRate
    const ringDuration = Math.min(3.2, Math.max(0.85, scaledDuration * 1.25 + 0.7))
    const stopAt = startAt + ringDuration
    const velocityLevel = 0.35 + note.velocity * 0.65
    const roleLevel = note.role === 'bass' ? 0.11 : note.role === 'melody' ? 0.13 : 0.085
    const baseLevel = roleLevel * velocityLevel
    const output = context.createGain()
    const filter = context.createBiquadFilter()
    const partials = [
      { ratio: 1, level: 1, decay: 1 },
      { ratio: 2.01, level: 0.34, decay: 0.62 },
      { ratio: 3.02, level: 0.16, decay: 0.42 },
      { ratio: 4.18, level: 0.09, decay: 0.28 },
    ]
    const oscillators: OscillatorNode[] = []
    const gains: GainNode[] = [output]

    filter.type = 'highshelf'
    filter.frequency.setValueAtTime(1800, startAt)
    filter.gain.setValueAtTime(5, startAt)
    output.gain.setValueAtTime(0.0001, startAt)
    output.gain.linearRampToValueAtTime(baseLevel, startAt + 0.012)
    output.gain.exponentialRampToValueAtTime(baseLevel * 0.34, startAt + 0.22)
    output.gain.exponentialRampToValueAtTime(0.0001, stopAt)
    output.connect(filter)
    filter.connect(master)

    partials.forEach((partial, index) => {
      const oscillator = context.createOscillator()
      const partialGain = context.createGain()
      const detune = index === 0 ? 0 : (index % 2 === 0 ? -4 : 5)

      oscillator.type = index === 0 ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, startAt)
      oscillator.detune.setValueAtTime(detune, startAt)
      partialGain.gain.setValueAtTime(0.0001, startAt)
      partialGain.gain.linearRampToValueAtTime(partial.level, startAt + 0.006)
      partialGain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, partial.level * 0.18),
        startAt + 0.16 * partial.decay,
      )
      partialGain.gain.exponentialRampToValueAtTime(0.0001, stopAt)

      oscillator.connect(partialGain)
      partialGain.connect(output)
      oscillator.start(startAt)
      oscillator.stop(stopAt + 0.03)
      oscillators.push(oscillator)
      gains.push(partialGain)
    })

    const click = context.createOscillator()
    const clickGain = context.createGain()

    click.type = 'square'
    click.frequency.setValueAtTime(frequency * 9.5, startAt)
    clickGain.gain.setValueAtTime(0.0001, startAt)
    clickGain.gain.linearRampToValueAtTime(baseLevel * 0.16, startAt + 0.003)
    clickGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.045)
    click.connect(clickGain)
    clickGain.connect(output)
    click.start(startAt)
    click.stop(startAt + 0.055)
    oscillators.push(click)
    gains.push(clickGain)

    const voice = { sources: oscillators, gains }
    this.activeVoices.push(voice)

    oscillators[0].onended = () => {
      filter.disconnect()
      this.cleanupVoice(voice)
    }
  }

  private cleanupVoice(voice: Voice) {
    voice.gains.forEach((gain) => {
      try {
        gain.disconnect()
      } catch {
        // Already disconnected.
      }
    })
    this.activeVoices = this.activeVoices.filter((item) => item !== voice)
  }

  private clearScheduler() {
    if (this.schedulerId === null) {
      return
    }

    window.clearInterval(this.schedulerId)
    this.schedulerId = null
  }

  private finish() {
    this.position = this.duration
    this.basePosition = this.duration
    this.state = 'stopped'
    this.nextNoteIndex = this.notes.length
    this.clearScheduler()
    this.stopActiveVoices()
  }

  private stopActiveVoices() {
    const contextTime = this.context?.currentTime ?? 0

    this.piano?.stopAll()

    this.activeVoices.forEach((voice) => {
      voice.gains.forEach((gain) => {
        gain.gain.cancelScheduledValues(contextTime)
        gain.gain.setValueAtTime(0.0001, contextTime)
      })

      voice.sources.forEach((source) => {
        try {
          source.stop(contextTime + 0.01)
        } catch {
          // Already stopped by the WebAudio scheduler.
        }
      })
    })

    this.activeVoices = []
  }
}
