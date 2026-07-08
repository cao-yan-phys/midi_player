import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasView } from './components/CanvasView'
import { Controls } from './components/Controls'
import { MidiDropzone } from './components/MidiDropzone'
import { parseGwCsv } from './midi/parseGwCsv'
import { parseMidi } from './midi/parseMidi'
import type { ParsedMidi } from './midi/noteTypes'
import { clampTranspose, transposeMidi } from './midi/transposeMidi'
import {
  DEFAULT_VOLUME,
  normalizePlaybackRate,
  MidiTransport,
  type PlaybackRate,
  type SoundPreset,
} from './playback/transport'

const defaultMidiFileName = 'BWV862.mid'
const defaultMidiUrl = `${import.meta.env.BASE_URL}${defaultMidiFileName}`
const defaultCsvFileName = 'sxs_bbh_0001_22.csv'
const defaultCsvUrl = `${import.meta.env.BASE_URL}${defaultCsvFileName}`

type SourceKind = 'midi' | 'csv'

const isMidiFile = (file: File) => /\.(mid|midi)$/i.test(file.name)
const isCsvFile = (file: File) => /\.csv$/i.test(file.name)

const withVisualSeed = (parsed: ParsedMidi): ParsedMidi => ({
  ...parsed,
  visualSeed: Math.floor(Math.random() * 1_000_000_000),
})

function App() {
  const [sourceMidi, setSourceMidi] = useState<ParsedMidi | null>(null)
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [visibleTracks, setVisibleTracks] = useState<Set<number>>(new Set())
  const [soundPreset, setSoundPreset] = useState<SoundPreset>('grandPiano')
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [transposeSemitones, setTransposeSemitones] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isZen, setIsZen] = useState(false)
  const [isOverview, setIsOverview] = useState(false)
  const appRef = useRef<HTMLDivElement | null>(null)
  const transportRef = useRef<MidiTransport | null>(null)
  const loadRequestIdRef = useRef(0)
  const midi = useMemo(
    () =>
      sourceMidi
        ? transposeMidi(sourceMidi, transposeSemitones)
        : null,
    [sourceMidi, transposeSemitones],
  )

  if (!transportRef.current) {
    transportRef.current = new MidiTransport((endedAt) => {
      setCurrentTime(endedAt)
      setIsPlaying(false)
      setIsOverview(true)
    })
  }

  const loadParsedMidi = useCallback((parsed: ParsedMidi, kind: SourceKind) => {
    const seeded = withVisualSeed(parsed)
    const nextVisibleTracks = new Set(parsed.tracks.map((track) => track.track))

    transportRef.current?.load(seeded.notes, seeded.duration, nextVisibleTracks)
    transportRef.current?.preloadCurrentSound()
    setError(null)
    setSourceMidi(seeded)
    setSourceKind(kind)
    setTransposeSemitones(0)
    setCurrentTime(0)
    setIsPlaying(false)
    setIsOverview(false)
    setVisibleTracks(nextVisibleTracks)
  }, [])

  useEffect(() => {
    if (!isPlaying) {
      return
    }

    const intervalId = window.setInterval(() => {
      const transport = transportRef.current

      if (transport) {
        setCurrentTime(transport.getCurrentTime())
      }
    }, 100)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isPlaying])

  const loadDefaultMidi = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestIdRef.current

    setError(null)

    try {
      const response = await fetch(defaultMidiUrl, { signal })

      if (!response.ok) {
        throw new Error(`Could not load ${defaultMidiFileName}.`)
      }

      const parsed = await parseMidi(defaultMidiFileName, await response.arrayBuffer())

      if (signal?.aborted || requestId !== loadRequestIdRef.current) {
        return
      }

      loadParsedMidi(parsed, 'midi')
    } catch (caughtError) {
      if (signal?.aborted || requestId !== loadRequestIdRef.current) {
        return
      }

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `Could not load ${defaultMidiFileName}.`,
      )
    }
  }, [loadParsedMidi])

  const loadDefaultCsv = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestIdRef.current

    setError(null)

    try {
      const response = await fetch(defaultCsvUrl, { signal })

      if (!response.ok) {
        throw new Error(`Could not load ${defaultCsvFileName}.`)
      }

      const parsed = parseGwCsv(defaultCsvFileName, await response.text())

      if (signal?.aborted || requestId !== loadRequestIdRef.current) {
        return
      }

      loadParsedMidi(parsed, 'csv')
    } catch (caughtError) {
      if (signal?.aborted || requestId !== loadRequestIdRef.current) {
        return
      }

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `Could not load ${defaultCsvFileName}.`,
      )
    }
  }, [loadParsedMidi])

  useEffect(() => {
    const controller = new AbortController()

    void loadDefaultCsv(controller.signal)

    return () => {
      controller.abort()
    }
  }, [loadDefaultCsv])

  useEffect(() => {
    transportRef.current?.setVisibleTracks(visibleTracks)
  }, [visibleTracks])

  useEffect(() => {
    transportRef.current?.setSoundPreset(soundPreset)
  }, [soundPreset])

  useEffect(() => {
    transportRef.current?.setPlaybackRate(playbackRate)
  }, [playbackRate])

  useEffect(() => {
    transportRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsZen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const handleMidiFile = useCallback(async (file: File) => {
    const requestId = ++loadRequestIdRef.current

    setError(null)

    try {
      const parsed = await parseMidi(file.name, await file.arrayBuffer())

      if (requestId !== loadRequestIdRef.current) {
        return
      }

      loadParsedMidi(parsed, 'midi')
    } catch (caughtError) {
      if (requestId !== loadRequestIdRef.current) {
        return
      }

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not parse this MIDI file.',
      )
    }
  }, [loadParsedMidi])

  const handleCsvFile = useCallback(async (file: File) => {
    const requestId = ++loadRequestIdRef.current

    setError(null)

    try {
      const parsed = parseGwCsv(file.name, await file.text())

      if (requestId !== loadRequestIdRef.current) {
        return
      }

      loadParsedMidi(parsed, 'csv')
    } catch (caughtError) {
      if (requestId !== loadRequestIdRef.current) {
        return
      }

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not parse this CSV file.',
      )
    }
  }, [loadParsedMidi])

  const handlePlay = useCallback(() => {
    if (!midi) {
      return
    }

    const startAt =
      isOverview || currentTime >= midi.duration
        ? 0
        : currentTime

    setIsOverview(false)
    setCurrentTime(startAt)
    void transportRef.current?.play(startAt)
    setIsPlaying(true)
  }, [currentTime, isOverview, midi])

  const handlePause = useCallback(() => {
    const transport = transportRef.current

    if (!transport) {
      return
    }

    transport.pause()
    setCurrentTime(transport.getCurrentTime())
    setIsPlaying(false)
  }, [])

  const handleStop = useCallback(() => {
    transportRef.current?.stop()
    setCurrentTime(0)
    setIsPlaying(false)
    setIsOverview(false)
  }, [])

  const handleSeek = useCallback((time: number) => {
    transportRef.current?.seek(time)
    setCurrentTime(time)
    setIsOverview(false)
  }, [])

  const handlePlaybackRateChange = useCallback((rate: PlaybackRate) => {
    const nextRate = normalizePlaybackRate(rate)
    setPlaybackRate(nextRate)
    transportRef.current?.setPlaybackRate(nextRate)
  }, [])

  const handleTransposeChange = useCallback(
    (semitones: number) => {
      const nextTranspose = clampTranspose(semitones)
      setTransposeSemitones(nextTranspose)

      if (!sourceMidi) {
        return
      }

      const nextMidi = transposeMidi(sourceMidi, nextTranspose)
      const transport = transportRef.current
      const wasOverview = isOverview && !isPlaying
      const transportTime = transport?.getCurrentTime() ?? currentTime
      const nextTime = wasOverview
        ? nextMidi.duration
        : Math.min(Math.max(transportTime, 0), nextMidi.duration)

      transport?.load(nextMidi.notes, nextMidi.duration, visibleTracks)
      transport?.preloadCurrentSound()
      transport?.seek(nextTime)

      if (isPlaying) {
        setIsOverview(false)
        void transport?.play(nextTime)
      } else {
        setIsOverview(wasOverview)
      }

      setCurrentTime(nextTime)
    },
    [currentTime, isOverview, isPlaying, sourceMidi, visibleTracks],
  )

  const handleToggleTrack = useCallback((track: number) => {
    setVisibleTracks((previous) => {
      const next = new Set(previous)

      if (next.has(track)) {
        next.delete(track)
      } else {
        next.add(track)
      }

      return next
    })
  }, [])

  const handleToggleZen = useCallback(() => {
    const app = appRef.current

    if (!app) {
      return
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }

    void app.requestFullscreen()
  }, [])

  const getTransportTime = useCallback(() => {
    return transportRef.current?.getCurrentTime() ?? 0
  }, [])

  return (
    <main className={isZen ? 'app-shell is-zen' : 'app-shell'} ref={appRef}>
      <header className="topbar">
        <MidiDropzone
          accept=".mid,.midi,audio/midi"
          defaultFileName={defaultMidiFileName}
          emptyHint=".mid / .midi"
          emptyLabel="MIDI"
          fileName={sourceKind === 'midi' ? sourceMidi?.fileName ?? null : null}
          isActive={sourceKind === 'midi'}
          isSupportedFile={isMidiFile}
          kind="midi"
          noteCount={sourceKind === 'midi' ? sourceMidi?.notes.length ?? 0 : 0}
          onFile={handleMidiFile}
          onLoadDefault={() => {
            void loadDefaultMidi()
          }}
        />
        <MidiDropzone
          accept=".csv,text/csv"
          defaultFileName={defaultCsvFileName}
          emptyHint=".csv"
          emptyLabel="GW CSV"
          fileName={sourceKind === 'csv' ? sourceMidi?.fileName ?? null : null}
          isActive={sourceKind === 'csv'}
          isSupportedFile={isCsvFile}
          kind="csv"
          noteCount={sourceKind === 'csv' ? sourceMidi?.notes.length ?? 0 : 0}
          onFile={handleCsvFile}
          onLoadDefault={() => {
            void loadDefaultCsv()
          }}
        />
      </header>

      <CanvasView
        midi={midi}
        currentTime={currentTime}
        isPlaying={isPlaying}
        isOverview={isOverview}
        getCurrentTime={getTransportTime}
        visibleTracks={visibleTracks}
      />

      {error ? <p className="error-line">{error}</p> : null}

      <Controls
        disabled={!midi}
        isPlaying={isPlaying}
        isZen={isZen}
        currentTime={currentTime}
        duration={midi?.duration ?? 0}
        soundPreset={soundPreset}
        playbackRate={playbackRate}
        volume={volume}
        transposeSemitones={transposeSemitones}
        tracks={midi?.tracks ?? []}
        visibleTracks={visibleTracks}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onSeek={handleSeek}
        onSoundPresetChange={setSoundPreset}
        onPlaybackRateChange={handlePlaybackRateChange}
        onVolumeChange={setVolume}
        onTransposeChange={handleTransposeChange}
        onToggleTrack={handleToggleTrack}
        onToggleZen={handleToggleZen}
      />
    </main>
  )
}

export default App
