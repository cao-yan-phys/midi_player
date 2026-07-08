import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { TrackSummary } from '../midi/noteTypes'
import { MAX_TRANSPOSE, MIN_TRANSPOSE } from '../midi/transposeMidi'
import {
  DEFAULT_VOLUME,
  MAX_VOLUME,
  PLAYBACK_RATES,
  type PlaybackRate,
  type SoundPreset,
} from '../playback/transport'

interface ControlsProps {
  disabled: boolean
  isPlaying: boolean
  isZen: boolean
  currentTime: number
  duration: number
  soundPreset: SoundPreset
  playbackRate: PlaybackRate
  volume: number
  transposeSemitones: number
  tracks: TrackSummary[]
  visibleTracks: ReadonlySet<number>
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSeek: (time: number) => void
  onSoundPresetChange: (soundPreset: SoundPreset) => void
  onPlaybackRateChange: (playbackRate: PlaybackRate) => void
  onVolumeChange: (volume: number) => void
  onTransposeChange: (semitones: number) => void
  onToggleTrack: (track: number) => void
  onToggleZen: () => void
}

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = Math.floor(safeSeconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const formatTranspose = (semitones: number) =>
  semitones > 0 ? `+${semitones} st` : `${semitones} st`

const formatPlaybackRate = (playbackRate: PlaybackRate) => {
  if (playbackRate === 0.25) {
    return '1/4 ×'
  }

  if (playbackRate === 0.5) {
    return '1/2 ×'
  }

  return `${playbackRate} ×`
}

export function Controls({
  disabled,
  isPlaying,
  isZen,
  currentTime,
  duration,
  soundPreset,
  playbackRate,
  volume,
  transposeSemitones,
  tracks,
  visibleTracks,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSoundPresetChange,
  onPlaybackRateChange,
  onVolumeChange,
  onTransposeChange,
  onToggleTrack,
  onToggleZen,
}: ControlsProps) {
  return (
    <section className="controls" aria-label="Playback controls">
      <div className="transport-row">
        <button
          className="icon-button"
          type="button"
          disabled={disabled}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={isPlaying ? onPause : onPlay}
        >
          {isPlaying ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          className="icon-button"
          type="button"
          disabled={disabled}
          title="Stop"
          aria-label="Stop"
          onClick={onStop}
        >
          <Square size={15} />
        </button>
        <select
          className="sound-select"
          value={soundPreset}
          aria-label="Sound preset"
          onChange={(event) =>
            onSoundPresetChange(event.currentTarget.value as SoundPreset)
          }
        >
          <option value="grandPiano">Grand Piano</option>
          <option value="softSynth">Soft Synth</option>
          <option value="musicBox">Music Box</option>
        </select>
        <select
          className="speed-select"
          value={playbackRate}
          disabled={disabled}
          aria-label="Playback speed"
          onChange={(event) =>
            onPlaybackRateChange(Number(event.currentTarget.value) as PlaybackRate)
          }
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {formatPlaybackRate(rate)}
            </option>
          ))}
        </select>
        <div className="volume-control" aria-label="Volume">
          {volume <= 0.01 ? (
            <VolumeX size={15} aria-hidden="true" />
          ) : (
            <Volume2 size={15} aria-hidden="true" />
          )}
          <input
            className="volume-range"
            type="range"
            min={0}
            max={MAX_VOLUME}
            step={0.01}
            value={volume}
            disabled={disabled}
            aria-label="Volume"
            onChange={(event) =>
              onVolumeChange(Number(event.currentTarget.value))
            }
          />
          <button
            className="icon-button compact-button"
            type="button"
            disabled={disabled || Math.abs(volume - DEFAULT_VOLUME) < 0.005}
            title="Reset volume"
            aria-label="Reset volume"
            onClick={() => onVolumeChange(DEFAULT_VOLUME)}
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <div className="transpose-control" aria-label="Transpose">
          <button
            className="icon-button compact-button"
            type="button"
            disabled={disabled || transposeSemitones <= MIN_TRANSPOSE}
            title="Transpose down"
            aria-label="Transpose down"
            onClick={() => onTransposeChange(transposeSemitones - 1)}
          >
            <Minus size={14} />
          </button>
          <input
            className="transpose-range"
            type="range"
            min={MIN_TRANSPOSE}
            max={MAX_TRANSPOSE}
            step={1}
            value={transposeSemitones}
            disabled={disabled}
            aria-label="Transpose semitones"
            onChange={(event) =>
              onTransposeChange(Number(event.currentTarget.value))
            }
          />
          <span className="transpose-readout">
            {formatTranspose(transposeSemitones)}
          </span>
          <button
            className="icon-button compact-button"
            type="button"
            disabled={disabled || transposeSemitones >= MAX_TRANSPOSE}
            title="Transpose up"
            aria-label="Transpose up"
            onClick={() => onTransposeChange(transposeSemitones + 1)}
          >
            <Plus size={14} />
          </button>
          <button
            className="icon-button compact-button"
            type="button"
            disabled={disabled || transposeSemitones === 0}
            title="Reset transpose"
            aria-label="Reset transpose"
            onClick={() => onTransposeChange(0)}
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <div className="progress-group">
          <input
            className="progress"
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(currentTime, duration)}
            disabled={disabled}
            aria-label="Playback progress"
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
          />
          <span className="time-readout">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
        <button
          className="icon-button"
          type="button"
          title={isZen ? 'Exit Zen Mode' : 'Zen Mode'}
          aria-label={isZen ? 'Exit Zen Mode' : 'Zen Mode'}
          onClick={onToggleZen}
        >
          {isZen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      <div className="track-row" aria-label="Tracks">
        {tracks.map((track) => {
          const isVisible = visibleTracks.has(track.track)

          return (
            <button
              key={track.track}
              className={isVisible ? 'track-chip is-visible' : 'track-chip'}
              type="button"
              title={`${isVisible ? 'Hide' : 'Show'} ${track.name}`}
              onClick={() => onToggleTrack(track.track)}
            >
              {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
              <span>{track.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
