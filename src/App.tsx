import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasView } from './components/CanvasView'
import { Controls } from './components/Controls'
import { MidiDropzone } from './components/MidiDropzone'
import { findMotifGroups } from './midi/motifAnalysis'
import { analyzeLocalKey } from './midi/keyAnalysis'
import { parseGwCsv } from './midi/parseGwCsv'
import { parseMidi } from './midi/parseMidi'
import type { ParsedMidi } from './midi/noteTypes'
import { findSymmetryGroups } from './midi/symmetryAnalysis'
import { clampTranspose, transposeMidi } from './midi/transposeMidi'
import {
  DEFAULT_VOLUME,
  normalizePlaybackRate,
  MidiTransport,
  type PlaybackRate,
  type SoundPreset,
} from './playback/transport'

const defaultMidiFileName = 'BWV862_prelude.mid'
const defaultMidiUrl = `${import.meta.env.BASE_URL}${defaultMidiFileName}`
const defaultCsvFileName = 'sxs_bbh_0001_i60_phi0_ell8.csv'
const defaultCsvUrl = `${import.meta.env.BASE_URL}${defaultCsvFileName}`

type SourceKind = 'midi' | 'csv'

const isMidiFile = (file: File) => /\.(mid|midi)$/i.test(file.name)
const isCsvFile = (file: File) => /\.csv$/i.test(file.name)

function App() {
  const [sourceMidi, setSourceMidi] = useState<ParsedMidi | null>(null)
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const [visibleTracks, setVisibleTracks] = useState<Set<number>>(new Set())
  const [soundPreset, setSoundPreset] = useState<SoundPreset>('grandPiano')
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [transposeSemitones, setTransposeSemitones] = useState(0)
  const [motifTraceEnabled, setMotifTraceEnabled] = useState(true)
  const [axisSymmetryEnabled, setAxisSymmetryEnabled] = useState(false)
  const [centerSymmetryEnabled, setCenterSymmetryEnabled] = useState(false)
  const [showChromaticLines, setShowChromaticLines] = useState(true)
  const [showStaffLines, setShowStaffLines] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isZen, setIsZen] = useState(false)
  const [isOverview, setIsOverview] = useState(false)
  const [keyName, setKeyName] = useState<string | null>(null)
  const appRef = useRef<HTMLDivElement | null>(null)
  const transportRef = useRef<MidiTransport | null>(null)
  const loadRequestIdRef = useRef(0)
  const playRequestIdRef = useRef(0)
  const midi = useMemo(
    () =>
      sourceMidi
        ? transposeMidi(sourceMidi, transposeSemitones)
        : null,
    [sourceMidi, transposeSemitones],
  )
  const motifGroups = useMemo(
    () =>
      sourceKind === 'midi' && sourceMidi
        ? findMotifGroups(sourceMidi.notes)
        : [],
    [sourceKind, sourceMidi, findMotifGroups],
  )
  const motifOccurrenceCount = useMemo(
    () =>
      motifGroups.reduce(
        (count, group) => count + group.occurrences.length,
        0,
      ),
    [motifGroups],
  )
  const symmetryGroups = useMemo(
    () =>
      sourceKind === 'midi' && sourceMidi
        ? findSymmetryGroups(sourceMidi.notes)
        : { axis: [], center: [] },
    [sourceKind, sourceMidi],
  )

  if (!transportRef.current) {
    transportRef.current = new MidiTransport((endedAt) => {
      setCurrentTime(endedAt)
      setIsPlaying(false)
      setIsOverview(true)
    })
  }

  const loadParsedMidi = useCallback((parsed: ParsedMidi, kind: SourceKind) => {
    playRequestIdRef.current += 1
    const nextVisibleTracks = new Set(parsed.tracks.map((track) => track.track))

    transportRef.current?.load(parsed.notes, parsed.duration, nextVisibleTracks)
    transportRef.current?.preloadCurrentSound()
    setError(null)
    setSourceMidi(parsed)
    setSourceKind(kind)
    setTransposeSemitones(0)
    setMotifTraceEnabled(kind === 'midi')
    setCurrentTime(0)
    setIsPlaying(false)
    setIsPreparing(false)
    setIsOverview(false)
    setKeyName(null)
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

    void loadDefaultMidi(controller.signal)

    return () => {
      controller.abort()
    }
  }, [loadDefaultMidi])

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

  const handlePlay = useCallback(async () => {
    const transport = transportRef.current

    if (!midi || !transport || isPreparing) {
      return
    }

    const startAt =
      isOverview || currentTime >= midi.duration
        ? 0
        : currentTime

    const requestId = ++playRequestIdRef.current
    setIsPreparing(true)
    setIsOverview(false)
    setKeyName(null)
    setCurrentTime(startAt)

    try {
      await transport.play(startAt)

      if (requestId !== playRequestIdRef.current) {
        transport.stop()
        return
      }

      setIsPlaying(true)
    } catch (caughtError) {
      if (requestId === playRequestIdRef.current) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Could not start playback.',
        )
      }
    } finally {
      if (requestId === playRequestIdRef.current) {
        setIsPreparing(false)
      }
    }
  }, [currentTime, isOverview, isPreparing, midi])

  const handlePause = useCallback(() => {
    const transport = transportRef.current

    if (!transport) {
      return
    }

    playRequestIdRef.current += 1
    transport.pause()
    setCurrentTime(transport.getCurrentTime())
    setIsPlaying(false)
    setIsPreparing(false)
  }, [])

  const handleStop = useCallback(() => {
    playRequestIdRef.current += 1
    transportRef.current?.stop()
    setCurrentTime(0)
    setIsPlaying(false)
    setIsPreparing(false)
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
      setKeyName(null)

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
      void document.exitFullscreen().finally(() => setIsZen(false))
      return
    }

    void app.requestFullscreen().catch(() => setIsZen(false))
  }, [])

  const handleToggleKeyAnalysis = useCallback(() => {
    if (!midi || isPlaying || isPreparing) {
      return
    }

    setKeyName((current) => {
      if (current) {
        return null
      }

      return analyzeLocalKey(midi.notes, currentTime, midi.duration)?.label ?? null
    })
  }, [currentTime, isPlaying, isPreparing, midi])

  const getTransportTime = useCallback(() => {
    return transportRef.current?.getCurrentTime() ?? 0
  }, [])

  return (
    <main className={isZen ? 'app-shell is-zen' : 'app-shell'} ref={appRef}>
      <header className="topbar">
        <MidiDropzone
          accept=".mid,.midi"
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
          accept=".csv"
          defaultFileName={defaultCsvFileName}
          emptyHint={
            <>
              .csv (h = h<sub>+</sub> − i h<sub>×</sub>)
            </>
          }
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
        motifGroups={motifGroups}
        motifTraceEnabled={motifTraceEnabled && sourceKind === 'midi'}
        symmetryGroups={symmetryGroups}
        axisSymmetryEnabled={axisSymmetryEnabled && sourceKind === 'midi'}
        centerSymmetryEnabled={centerSymmetryEnabled && sourceKind === 'midi'}
        showChromaticLines={showChromaticLines}
        showStaffLines={showStaffLines}
        keyName={keyName}
      />

      {error ? <p className="error-line">{error}</p> : null}

      <Controls
        disabled={!midi}
        isPlaying={isPlaying}
        isPreparing={isPreparing}
        keyAnalysisVisible={Boolean(keyName)}
        isZen={isZen}
        currentTime={currentTime}
        duration={midi?.duration ?? 0}
        soundPreset={soundPreset}
        playbackRate={playbackRate}
        volume={volume}
        transposeSemitones={transposeSemitones}
        motifTraceEnabled={motifTraceEnabled}
        motifOccurrenceCount={motifOccurrenceCount}
        symmetryAvailable={sourceKind === 'midi'}
        axisSymmetryEnabled={axisSymmetryEnabled}
        centerSymmetryEnabled={centerSymmetryEnabled}
        showChromaticLines={showChromaticLines}
        showStaffLines={showStaffLines}
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
        onToggleMotifTrace={() => setMotifTraceEnabled((enabled) => !enabled)}
        onToggleAxisSymmetry={() => setAxisSymmetryEnabled((enabled) => !enabled)}
        onToggleCenterSymmetry={() =>
          setCenterSymmetryEnabled((enabled) => !enabled)
        }
        onToggleChromaticLines={() =>
          setShowChromaticLines((enabled) => !enabled)
        }
        onToggleStaffLines={() => setShowStaffLines((enabled) => !enabled)}
        onToggleKeyAnalysis={handleToggleKeyAnalysis}
        onToggleTrack={handleToggleTrack}
        onToggleZen={handleToggleZen}
      />
    </main>
  )
}

export default App
