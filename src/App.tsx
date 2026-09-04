import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasView } from './components/CanvasView'
import { Controls } from './components/Controls'
import { MidiDropzone } from './components/MidiDropzone'
import { findMotifGroups } from './midi/motifAnalysis'
import { analyzeLocalKey } from './midi/keyAnalysis'
import {
  DEFAULT_KEYBOARD_OCTAVE_LEVEL,
  isEditableKeyboardTarget,
  keyboardOctaveLevelForCode,
  keyboardPitchForCode,
} from './playback/keyboardMap'
import { parseGwCsv } from './midi/parseGwCsv'
import { parseMidi } from './midi/parseMidi'
import type { ParsedMidi } from './midi/noteTypes'
import { reverseMidi } from './midi/reverseMidi'
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
  const [reversePlayback, setReversePlayback] = useState(false)
  const [motifTraceEnabled, setMotifTraceEnabled] = useState(true)
  const [axisSymmetryEnabled, setAxisSymmetryEnabled] = useState(false)
  const [centerSymmetryEnabled, setCenterSymmetryEnabled] = useState(false)
  const [showChromaticLines, setShowChromaticLines] = useState(true)
  const [showStaffLines, setShowStaffLines] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isZen, setIsZen] = useState(false)
  const [isOverview, setIsOverview] = useState(false)
  const [keyName, setKeyName] = useState<string | null>(null)
  const [pressedKeyboardPitches, setPressedKeyboardPitches] = useState<
    ReadonlySet<number>
  >(new Set())
  const [pressedKeyboardCodes, setPressedKeyboardCodes] = useState<
    ReadonlySet<string>
  >(new Set())
  const [keyboardOctaveLevel, setKeyboardOctaveLevel] = useState(
    DEFAULT_KEYBOARD_OCTAVE_LEVEL,
  )
  const appRef = useRef<HTMLDivElement | null>(null)
  const transportRef = useRef<MidiTransport | null>(null)
  const loadRequestIdRef = useRef(0)
  const playRequestIdRef = useRef(0)
  const midi = useMemo(() => {
    if (!sourceMidi) {
      return null
    }

    const transposed = transposeMidi(sourceMidi, transposeSemitones)

    return reversePlayback ? reverseMidi(transposed) : transposed
  }, [reversePlayback, sourceMidi, transposeSemitones])
  const motifGroups = useMemo(
    () =>
      sourceKind === 'midi' && midi
        ? findMotifGroups(midi.notes)
        : [],
    [sourceKind, midi, findMotifGroups],
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
      sourceKind === 'midi' && midi
        ? findSymmetryGroups(midi.notes)
        : { axis: [], center: [] },
    [sourceKind, midi],
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
    void transportRef.current?.prepareKeyboardOctave(
      DEFAULT_KEYBOARD_OCTAVE_LEVEL,
    )
    setError(null)
    setSourceMidi(parsed)
    setSourceKind(kind)
    setTransposeSemitones(0)
    setReversePlayback(false)
    setMotifTraceEnabled(kind === 'midi')
    setCurrentTime(0)
    setIsPlaying(false)
    setIsPreparing(false)
    setIsOverview(false)
    setKeyName(null)
    setKeyboardOctaveLevel(DEFAULT_KEYBOARD_OCTAVE_LEVEL)
    setPressedKeyboardPitches(new Set())
    setPressedKeyboardCodes(new Set())
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
    const transport = transportRef.current
    transport?.releaseKeyboardNotes()
    setPressedKeyboardPitches(new Set())
    setPressedKeyboardCodes(new Set())
    transport?.setSoundPreset(soundPreset)
  }, [soundPreset])

  useEffect(() => {
    transportRef.current?.setPlaybackRate(playbackRate)
  }, [playbackRate])

  useEffect(() => {
    transportRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    const transport = transportRef.current

    if (!midi || isPlaying || isPreparing) {
      transport?.releaseKeyboardNotes()
      setPressedKeyboardPitches(new Set())
      setPressedKeyboardCodes(new Set())
      return
    }

    const releaseAll = () => {
      transport?.releaseKeyboardNotes()
      setPressedKeyboardPitches(new Set())
      setPressedKeyboardCodes(new Set())
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return
      }

      const octaveLevel = keyboardOctaveLevelForCode(event.code)

      if (octaveLevel !== undefined) {
        event.preventDefault()

        if (event.repeat) {
          return
        }

        if (octaveLevel !== keyboardOctaveLevel) {
          releaseAll()
          setKeyboardOctaveLevel(octaveLevel)
          void transport?.prepareKeyboardOctave(octaveLevel)
        }

        return
      }

      const pitch = keyboardPitchForCode(event.code, keyboardOctaveLevel)

      if (pitch === undefined) {
        return
      }

      event.preventDefault()

      if (event.repeat) {
        return
      }

      setPressedKeyboardPitches((current) => {
        if (current.has(pitch)) {
          return current
        }

        return new Set(current).add(pitch)
      })
      setPressedKeyboardCodes((current) => {
        if (current.has(event.code)) {
          return current
        }

        return new Set(current).add(event.code)
      })
      void transport?.previewKeyDown(pitch, keyboardOctaveLevel)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const pitch = keyboardPitchForCode(event.code, keyboardOctaveLevel)

      if (pitch === undefined) {
        return
      }

      event.preventDefault()
      transport?.previewKeyUp(pitch)
      setPressedKeyboardPitches((current) => {
        if (!current.has(pitch)) {
          return current
        }

        const next = new Set(current)
        next.delete(pitch)
        return next
      })
      setPressedKeyboardCodes((current) => {
        if (!current.has(event.code)) {
          return current
        }

        const next = new Set(current)
        next.delete(event.code)
        return next
      })
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releaseAll()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      transport?.releaseKeyboardNotes()
    }
  }, [isPlaying, isPreparing, keyboardOctaveLevel, midi])

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

  const handleToggleReversePlayback = useCallback(() => {
    if (!sourceMidi || isPlaying || isPreparing) {
      return
    }

    const nextReversePlayback = !reversePlayback
    const transposed = transposeMidi(sourceMidi, transposeSemitones)
    const nextMidi = nextReversePlayback ? reverseMidi(transposed) : transposed

    playRequestIdRef.current += 1
    transportRef.current?.load(nextMidi.notes, nextMidi.duration, visibleTracks)
    transportRef.current?.preloadCurrentSound()
    transportRef.current?.seek(0)
    setReversePlayback(nextReversePlayback)
    setCurrentTime(0)
    setIsPlaying(false)
    setIsPreparing(false)
    setIsOverview(false)
    setKeyName(null)
  }, [
    isPlaying,
    isPreparing,
    reversePlayback,
    sourceMidi,
    transposeSemitones,
    visibleTracks,
  ])

  const handleTransposeChange = useCallback(
    (semitones: number) => {
      const nextTranspose = clampTranspose(semitones)
      setTransposeSemitones(nextTranspose)
      setKeyName(null)

      if (!sourceMidi) {
        return
      }

      const transposed = transposeMidi(sourceMidi, nextTranspose)
      const nextMidi = reversePlayback ? reverseMidi(transposed) : transposed
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
    [
      currentTime,
      isOverview,
      isPlaying,
      reversePlayback,
      sourceMidi,
      visibleTracks,
    ],
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
            highlightedPitches={pressedKeyboardPitches}
            keyboardOctaveLevel={keyboardOctaveLevel}
            pressedKeyboardCodes={pressedKeyboardCodes}
            keyboardEnabled={Boolean(midi) && !isPlaying && !isPreparing}
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
            reversePlayback={reversePlayback}
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
            onToggleReversePlayback={handleToggleReversePlayback}
            onSeek={handleSeek}
            onSoundPresetChange={setSoundPreset}
            onPlaybackRateChange={handlePlaybackRateChange}
            onVolumeChange={setVolume}
            onTransposeChange={handleTransposeChange}
            onToggleMotifTrace={() =>
              setMotifTraceEnabled((enabled) => !enabled)
            }
            onToggleAxisSymmetry={() =>
              setAxisSymmetryEnabled((enabled) => !enabled)
            }
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
