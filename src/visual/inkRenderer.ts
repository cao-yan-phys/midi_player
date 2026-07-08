import type { MidiNote } from '../midi/noteTypes'
import {
  type CoordinateSystem,
  createCoordinateSystem,
  roleBaseWidth,
  roleColor,
  visibleNotesInFlow,
} from './coordinate'

interface RenderInkOptions {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  notes: MidiNote[]
  duration: number
  currentTime: number
  overviewProgress?: number
  visibleTracks: ReadonlySet<number>
  visualSeed: number
}

interface InkPoint {
  x: number
  y: number
  time: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const withAlpha = (hex: string, alpha: number) => {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

const hash = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

const smoothStep = (value: number) => value * value * (3 - 2 * value)

const lerp = (from: number, to: number, progress: number) =>
  from + (to - from) * progress

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3

const noteSeed = (note: MidiNote, visualSeed: number) =>
  visualSeed * 0.001 +
  note.track * 919 +
  note.pitch * 37 +
  note.start * 101 +
  note.duration * 53

const wobbleY = (seed: number, time: number, amount: number) =>
  (Math.sin(time * 4.7 + seed * 0.019) +
    Math.sin(time * 9.3 + seed * 0.037) * 0.45 +
    Math.sin(time * 17.1 + seed * 0.011) * 0.16) *
  amount

const inkWidthForNote = (note: MidiNote) =>
  roleBaseWidth(note.role) * (1.48 + note.velocity * 1.16)

const inkAlphaForNote = (note: MidiNote) =>
  note.role === 'bass'
    ? 0.44 + note.velocity * 0.2
    : note.role === 'melody'
      ? 0.42 + note.velocity * 0.22
      : 0.28 + note.velocity * 0.16

const getPitchRange = (notes: MidiNote[]) =>
  notes.reduce(
    (range, note) => ({
      min: Math.min(range.min, note.pitch),
      max: Math.max(range.max, note.pitch),
    }),
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  )

const createOverviewCoordinateSystem = (
  width: number,
  height: number,
  duration: number,
  pitchRange: { min: number; max: number },
): CoordinateSystem => {
  const safeDuration = Math.max(duration, 0.01)
  const pitchCoordinates = createCoordinateSystem(
    width,
    height,
    duration,
    safeDuration,
    pitchRange,
  )
  const paddingX = clamp(width * 0.065, 28, 64)
  const innerWidth = Math.max(1, width - paddingX * 2)
  const pixelsPerSecond = innerWidth / safeDuration

  return {
    ...pitchCoordinates,
    pixelsPerSecond,
    writeHeadX: paddingX,
    visibleStart: 0,
    visibleEnd: safeDuration,
    trailSeconds: safeDuration,
    timeToX: (time) =>
      paddingX + clamp(time / safeDuration, 0, 1) * innerWidth,
    durationToWidth: (noteDuration) =>
      clamp(noteDuration, 0, safeDuration) * pixelsPerSecond,
    alphaForTime: () => 1,
  }
}

const createSettledCoordinateSystem = (
  width: number,
  height: number,
  duration: number,
  currentTime: number,
  pitchRange: { min: number; max: number },
  overviewProgress: number,
): CoordinateSystem => {
  const flow = createCoordinateSystem(
    width,
    height,
    duration,
    currentTime,
    pitchRange,
  )
  const overview = createOverviewCoordinateSystem(
    width,
    height,
    duration,
    pitchRange,
  )
  const progress = easeOutCubic(clamp(overviewProgress, 0, 1))

  if (progress <= 0) {
    return flow
  }

  if (progress >= 1) {
    return overview
  }

  return {
    ...flow,
    pixelsPerSecond: lerp(
      flow.pixelsPerSecond,
      overview.pixelsPerSecond,
      progress,
    ),
    writeHeadX: lerp(flow.writeHeadX, overview.writeHeadX, progress),
    visibleStart: lerp(flow.visibleStart, overview.visibleStart, progress),
    visibleEnd: lerp(flow.visibleEnd, overview.visibleEnd, progress),
    trailSeconds: lerp(flow.trailSeconds, overview.trailSeconds, progress),
    timeToX: (time) =>
      lerp(flow.timeToX(time), overview.timeToX(time), progress),
    pitchToY: (pitch, role) =>
      lerp(flow.pitchToY(pitch, role), overview.pitchToY(pitch, role), progress),
    durationToWidth: (noteDuration) =>
      lerp(
        flow.durationToWidth(noteDuration),
        overview.durationToWidth(noteDuration),
        progress,
      ),
    alphaForTime: (time) =>
      lerp(flow.alphaForTime(time), overview.alphaForTime(time), progress),
  }
}

const makeStableTimes = (
  anchorTime: number,
  startTime: number,
  endTime: number,
  stepSeconds: number,
) => {
  if (endTime <= startTime) {
    return []
  }

  const times = [startTime]
  const firstIndex = Math.ceil((startTime - anchorTime) / stepSeconds)

  for (let index = firstIndex; ; index += 1) {
    const time = anchorTime + index * stepSeconds

    if (time <= startTime + 0.0001) {
      continue
    }

    if (time >= endTime - 0.0001) {
      break
    }

    times.push(time)
  }

  times.push(endTime)
  return times
}

const makeNotePoints = (
  note: MidiNote,
  startTime: number,
  endTime: number,
  coordinates: ReturnType<typeof createCoordinateSystem>,
  visualSeed: number,
) => {
  const span = endTime - startTime

  if (span <= 0) {
    return []
  }

  const seed = noteSeed(note, visualSeed)
  const sampleTimes = makeStableTimes(
    note.start,
    startTime,
    endTime,
    24 / coordinates.pixelsPerSecond,
  )
  const baseY = coordinates.pitchToY(note.pitch, note.role)
  const wobbleAmount =
    note.role === 'bass' ? 1.4 : note.role === 'melody' ? 2.7 : 2.1
  const slowDrift = (hash(seed + 7) - 0.5) * 3.2

  if (sampleTimes.length < 2) {
    return []
  }

  return sampleTimes.map((t) => {
    const local = (t - note.start) / Math.max(note.duration, 0.001)
    const drift = Math.sin((local - 0.5) * Math.PI) * slowDrift

    return {
      x: coordinates.timeToX(t),
      y: baseY + drift + wobbleY(seed, t, wobbleAmount),
      time: t,
    }
  })
}

const makeTransitionPoints = (
  from: MidiNote,
  to: MidiNote,
  startTime: number,
  endTime: number,
  coordinates: ReturnType<typeof createCoordinateSystem>,
  visualSeed: number,
) => {
  const span = endTime - startTime

  if (span <= 0) {
    return []
  }

  const seed = noteSeed(from, visualSeed) + noteSeed(to, visualSeed) * 0.37
  const sampleTimes = makeStableTimes(
    from.end,
    startTime,
    endTime,
    22 / coordinates.pixelsPerSecond,
  )
  const y0 = coordinates.pitchToY(from.pitch, from.role)
  const y1 = coordinates.pitchToY(to.pitch, to.role)
  const arch = (hash(seed + 11) - 0.5) * Math.min(26, Math.abs(y1 - y0) * 0.22)

  if (sampleTimes.length < 2) {
    return []
  }

  return sampleTimes.map((t) => {
    const local = (t - from.end) / Math.max(to.start - from.end, 0.001)
    const eased = smoothStep(clamp(local, 0, 1))
    const bridge = Math.sin(eased * Math.PI) * arch

    return {
      x: coordinates.timeToX(t),
      y: y0 + (y1 - y0) * eased + bridge + wobbleY(seed, t, 1.1),
      time: t,
    }
  })
}

const drawEllipse = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
) => {
  ctx.beginPath()
  ctx.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2)
  ctx.fill()
}

const drawBrushStamp = (
  ctx: CanvasRenderingContext2D,
  point: InkPoint,
  tangentX: number,
  tangentY: number,
  width: number,
  color: string,
  alpha: number,
  seed: number,
  stampIndex: number,
  coordinates: ReturnType<typeof createCoordinateSystem>,
) => {
  const edgeAlpha = coordinates.alphaForTime(point.time)

  if (edgeAlpha <= 0.01) {
    return
  }

  const angle = Math.atan2(tangentY, tangentX)
  const grain = hash(seed + stampIndex * 3.71)
  const pressure =
    0.82 +
    Math.sin(point.time * 2.2 + seed * 0.017) * 0.1 +
    (grain - 0.5) * 0.18
  const localWidth = width * clamp(pressure, 0.58, 1.2)
  const normalJitter = (hash(seed + stampIndex * 9.43) - 0.5) * width * 0.1
  const tangentJitter = (hash(seed + stampIndex * 12.17) - 0.5) * width * 0.08
  const bristleCount = Math.round(clamp(width * 0.38, 5, 10))
  const baseAlpha = alpha * edgeAlpha

  ctx.save()
  ctx.translate(point.x, point.y)
  ctx.rotate(angle)
  ctx.globalCompositeOperation = 'multiply'

  ctx.fillStyle = withAlpha(color, baseAlpha * 0.045)
  drawEllipse(
    ctx,
    tangentJitter,
    normalJitter,
    localWidth * (0.92 + hash(seed + stampIndex) * 0.18),
    localWidth * (0.5 + hash(seed + stampIndex + 1) * 0.1),
    (hash(seed + stampIndex + 2) - 0.5) * 0.22,
  )

  ctx.fillStyle = withAlpha(color, baseAlpha * 0.12)
  drawEllipse(
    ctx,
    tangentJitter * 0.45,
    normalJitter * 0.45,
    localWidth * 0.5,
    localWidth * 0.36,
    (hash(seed + stampIndex + 4) - 0.5) * 0.18,
  )

  for (let index = 0; index < bristleCount; index += 1) {
    const lane = -0.5 + (index + 0.5) / bristleCount
    const laneSeed = seed + stampIndex * 31.7 + index * 17.3
    const dryBreak = hash(laneSeed + 4.2)
    const edge = Math.abs(lane)
    const isEdge = edge > 0.36

    if (dryBreak < (isEdge ? 0.2 : 0.08)) {
      continue
    }

    const y =
      lane * localWidth * (0.9 + hash(laneSeed + 1.1) * 0.18) +
      (hash(laneSeed + 2.3) - 0.5) * localWidth * 0.1
    const x = (hash(laneSeed + 3.4) - 0.5) * localWidth * 0.28
    const length =
      localWidth *
      (0.18 + hash(laneSeed + 5.6) * (isEdge ? 0.44 : 0.68))
    const thickness =
      localWidth * (0.018 + hash(laneSeed + 6.7) * (isEdge ? 0.045 : 0.07))
    const bristleAlpha =
      baseAlpha *
      (isEdge ? 0.14 : 0.2) *
      (0.55 + hash(laneSeed + 7.8) * 0.7)

    ctx.fillStyle = withAlpha(color, bristleAlpha)
    drawEllipse(
      ctx,
      x,
      y,
      length,
      thickness,
      (hash(laneSeed + 8.9) - 0.5) * 0.24,
    )
  }

  for (let index = 0; index < 2; index += 1) {
    const fleckSeed = seed + stampIndex * 47.1 + index * 13.9
    const side = hash(fleckSeed) > 0.5 ? 1 : -1
    const y =
      side *
      localWidth *
      (0.42 + hash(fleckSeed + 1.3) * 0.2)
    const x = (hash(fleckSeed + 2.5) - 0.5) * localWidth * 0.42
    const radius = localWidth * (0.035 + hash(fleckSeed + 3.6) * 0.08)

    ctx.fillStyle = withAlpha(color, baseAlpha * 0.09)
    drawEllipse(
      ctx,
      x,
      y,
      radius * (1.2 + hash(fleckSeed + 4.8)),
      radius * 0.55,
      hash(fleckSeed + 5.9) * Math.PI,
    )
  }

  ctx.restore()
}

const drawInkStroke = (
  ctx: CanvasRenderingContext2D,
  points: InkPoint[],
  color: string,
  width: number,
  alpha: number,
  seed: number,
  coordinates: ReturnType<typeof createCoordinateSystem>,
) => {
  if (points.length < 2) {
    return
  }

  let stampIndex = Math.floor(points[0].time * 120)

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)

    if (length <= 0.01) {
      continue
    }

    const tangentX = dx / length
    const tangentY = dy / length
    const spacing = clamp(width * 0.38, 4.8, 9.2)
    const stampCount = Math.max(1, Math.ceil(length / spacing))
    const startStamp = index === 0 ? 0 : 1

    for (let stamp = startStamp; stamp <= stampCount; stamp += 1) {
      const ratio = stamp / stampCount
      const point = {
        x: from.x + dx * ratio,
        y: from.y + dy * ratio,
        time: from.time + (to.time - from.time) * ratio,
      }

      drawBrushStamp(
        ctx,
        point,
        tangentX,
        tangentY,
        width,
        color,
        alpha,
        seed,
        stampIndex,
        coordinates,
      )
      stampIndex += 1
    }
  }
}

const drawDeposit = (
  ctx: CanvasRenderingContext2D,
  note: MidiNote,
  time: number,
  coordinates: ReturnType<typeof createCoordinateSystem>,
  visualSeed: number,
  scale = 1,
) => {
  const x = coordinates.timeToX(time)
  const y = coordinates.pitchToY(note.pitch, note.role)
  const edgeAlpha = coordinates.alphaForTime(time)

  if (edgeAlpha <= 0.02) {
    return
  }

  const color = roleColor(note.role, note.track)
  const seed = noteSeed(note, visualSeed)
  const width = inkWidthForNote(note) * scale
  const alpha = inkAlphaForNote(note) * edgeAlpha

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((hash(seed + 5) - 0.5) * 0.75)
  ctx.globalCompositeOperation = 'multiply'

  ctx.fillStyle = withAlpha(color, alpha * 0.08)
  drawEllipse(ctx, 0, 0, width * 1.35, width * 0.82, 0)

  for (let index = 0; index < 7; index += 1) {
    const size = width * (0.18 + hash(seed + index * 13) * 0.55)
    const offsetX = (hash(seed + index * 19) - 0.5) * width * 0.62
    const offsetY = (hash(seed + index * 23) - 0.5) * width * 0.46

    ctx.fillStyle = withAlpha(color, alpha * (0.18 - index * 0.014))
    ctx.beginPath()
    ctx.ellipse(
      offsetX,
      offsetY,
      size * 0.92,
      size * (0.48 + hash(seed + index * 31) * 0.22),
      hash(seed + index * 7) * Math.PI,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }

  ctx.restore()
}

const drawWetTip = (
  ctx: CanvasRenderingContext2D,
  note: MidiNote,
  currentTime: number,
  coordinates: ReturnType<typeof createCoordinateSystem>,
  visualSeed: number,
  scale = 1,
) => {
  const time = clamp(currentTime, note.start, note.end)
  const points = makeNotePoints(
    note,
    Math.max(note.start, time - 0.045),
    time,
    coordinates,
    visualSeed,
  )
  const point = points.at(-1)

  if (!point) {
    return
  }

  const color = roleColor(note.role, note.track)
  const width = inkWidthForNote(note) * scale
  const previous = points.at(-2) ?? {
    x: point.x - 1,
    y: point.y,
    time: point.time - 0.01,
  }
  const dx = point.x - previous.x
  const dy = point.y - previous.y
  const length = Math.max(0.001, Math.hypot(dx, dy))

  ctx.save()
  drawBrushStamp(
    ctx,
    point,
    dx / length,
    dy / length,
    width * 1.05,
    color,
    inkAlphaForNote(note) * 0.9,
    noteSeed(note, visualSeed) + 900,
    Math.floor(time * 120),
    coordinates,
  )
  ctx.fillStyle = withAlpha(color, 0.22 * coordinates.alphaForTime(time))
  ctx.globalCompositeOperation = 'multiply'
  drawEllipse(ctx, point.x, point.y, width * 0.44, width * 0.28, 0)
  ctx.restore()
}

const drawTrackInk = (
  ctx: CanvasRenderingContext2D,
  trackNotes: MidiNote[],
  visibleTrackNotes: MidiNote[],
  currentTime: number,
  coordinates: ReturnType<typeof createCoordinateSystem>,
  inkScale: number,
  showWetTip: boolean,
  visualSeed: number,
) => {
  const sorted = [...trackNotes].sort((a, b) => a.start - b.start)

  visibleTrackNotes.forEach((note) => {
    const start = Math.max(note.start, coordinates.visibleStart)
    const end = Math.min(note.end, currentTime, coordinates.visibleEnd)
    const points = makeNotePoints(note, start, end, coordinates, visualSeed)

    if (points.length < 2) {
      return
    }

    const color = roleColor(note.role, note.track)
    const seed = noteSeed(note, visualSeed)

    drawInkStroke(
      ctx,
      points,
      color,
      inkWidthForNote(note) * inkScale,
      inkAlphaForNote(note),
      seed,
      coordinates,
    )

    if (note.start >= coordinates.visibleStart && note.start <= currentTime) {
      drawDeposit(ctx, note, note.start, coordinates, visualSeed, 0.9 * inkScale)
    }
  })

  sorted.forEach((from, index) => {
    const to = sorted[index + 1]

    if (!to || from.track !== to.track) {
      return
    }

    const gap = to.start - from.end
    const writtenEnd = Math.min(currentTime, to.start, coordinates.visibleEnd)
    const start = Math.max(from.end, coordinates.visibleStart)

    if (
      gap < 0.025 ||
      gap > 0.42 ||
      writtenEnd <= start ||
      from.end > coordinates.visibleEnd ||
      to.start < coordinates.visibleStart
    ) {
      return
    }

    const points = makeTransitionPoints(
      from,
      to,
      start,
      writtenEnd,
      coordinates,
      visualSeed,
    )

    if (points.length < 2) {
      return
    }

    const color = roleColor(from.role, from.track)
    const width = (inkWidthForNote(from) + inkWidthForNote(to)) * 0.66 * inkScale
    const alpha = (inkAlphaForNote(from) + inkAlphaForNote(to)) * 0.58

    drawInkStroke(
      ctx,
      points,
      color,
      width,
      alpha,
      noteSeed(from, visualSeed) + 17,
      coordinates,
    )
  })

  if (!showWetTip) {
    return
  }

  const activeNote = sorted.find(
    (note) => note.start <= currentTime && note.end >= currentTime,
  )

  if (activeNote) {
    drawWetTip(ctx, activeNote, currentTime, coordinates, visualSeed, inkScale)
  }
}

export const renderInkFlow = ({
  ctx,
  width,
  height,
  notes,
  duration,
  currentTime,
  overviewProgress = 0,
  visibleTracks,
  visualSeed,
}: RenderInkOptions) => {
  const pitchRange = getPitchRange(notes)
  const safePitchRange = {
    min: Number.isFinite(pitchRange.min) ? pitchRange.min : 48,
    max: Number.isFinite(pitchRange.max) ? pitchRange.max : 72,
  }
  const progress = clamp(overviewProgress, 0, 1)
  const coordinates = createSettledCoordinateSystem(
    width,
    height,
    duration,
    currentTime,
    safePitchRange,
    progress,
  )
  const overviewInkScale = clamp(width / Math.max(duration * 120, width), 0.3, 1)
  const inkScale = lerp(1, overviewInkScale, easeOutCubic(progress))
  const showWetTip = progress < 0.08
  const visibleNotes = visibleNotesInFlow(
    notes,
    coordinates,
    currentTime,
    visibleTracks,
  )
  const allByTrack = new Map<number, MidiNote[]>()
  const visibleByTrack = new Map<number, MidiNote[]>()

  notes.forEach((note) => {
    if (!visibleTracks.has(note.track)) {
      return
    }

    const trackNotes = allByTrack.get(note.track)

    if (trackNotes) {
      trackNotes.push(note)
      return
    }

    allByTrack.set(note.track, [note])
  })

  visibleNotes.forEach((note) => {
    const trackNotes = visibleByTrack.get(note.track)

    if (trackNotes) {
      trackNotes.push(note)
      return
    }

    visibleByTrack.set(note.track, [note])
  })

  ;[...visibleByTrack.entries()]
    .sort(([, a], [, b]) => {
      const roleRank = { bass: 0, inner: 1, melody: 2 }
      return roleRank[a[0].role] - roleRank[b[0].role]
    })
    .forEach(([track, visibleTrackNotes]) => {
      drawTrackInk(
        ctx,
        allByTrack.get(track) ?? [],
        visibleTrackNotes,
        currentTime,
        coordinates,
        inkScale,
        showWetTip,
        visualSeed,
      )
    })
}
