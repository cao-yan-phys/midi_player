const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export interface HarmonicPartialProfile {
  ratio: number
  level: number
  decay: number
}

export interface SmallPianoVoiceProfile {
  noteLevel: number
  decay: number
  filterFrequency: number
  partials: HarmonicPartialProfile[]
}

const SMALL_PIANO_PARTIALS = [
  { ratio: 1, amplitude: 1, decay: 1 },
  { ratio: 2.004, amplitude: 0.17, decay: 0.62 },
  { ratio: 3.01, amplitude: 0.065, decay: 0.42 },
  { ratio: 4.018, amplitude: 0.02, decay: 0.27 },
]

const SMALL_PIANO_LOW_REGISTER_GAIN = 3.8
const OCARINA_LOW_REGISTER_GAIN = 8

const smallPianoLowRegisterAmount = (pitch: number) =>
  clamp((64 - pitch) / 30, 0, 1)

export const getSmallPianoVoiceProfile = (
  pitch: number,
  velocity: number,
  audibleDuration: number,
): SmallPianoVoiceProfile => {
  const lowRegister = smallPianoLowRegisterAmount(pitch)
  const velocityLevel = 0.24 + clamp(velocity, 0, 1) ** 0.66 * 0.76
  const noteLevel =
    0.18 *
    velocityLevel *
    (1 + lowRegister * (SMALL_PIANO_LOW_REGISTER_GAIN - 1))
  const unnormalizedPartials = SMALL_PIANO_PARTIALS.map((partial, index) => ({
    ratio: partial.ratio,
    decay: partial.decay,
    amplitude:
      index === 0
        ? partial.amplitude
        : partial.amplitude * (1 - lowRegister * (0.34 + index * 0.16)),
  }))
  const totalAmplitude = unnormalizedPartials.reduce(
    (sum, partial) => sum + partial.amplitude,
    0,
  )

  return {
    noteLevel,
    decay: Math.min(
      7.2,
      Math.max(1.8, audibleDuration * 1.9 + 1.15 + lowRegister * 0.55),
    ),
    filterFrequency: clamp(
      440 * 2 ** ((pitch - 69) / 12) * (3.1 + lowRegister * 0.5),
      680,
      4000,
    ),
    partials: unnormalizedPartials.map((partial) => ({
      ratio: partial.ratio,
      decay: partial.decay,
      level: partial.amplitude / totalAmplitude,
    })),
  }
}

export interface OcarinaGainProfile {
  level: number
  lowRegisterGain: number
}

const ocarinaLowRegisterAmount = (pitch: number) =>
  clamp((72 - pitch) / 36, 0, 1)

export const getOcarinaGainProfile = (
  pitch: number,
  velocity: number,
  sampleNormalization = 1,
): OcarinaGainProfile => {
  const lowRegisterGain =
    1 +
    ocarinaLowRegisterAmount(pitch) * (OCARINA_LOW_REGISTER_GAIN - 1)
  const velocityLevel = 0.08 + clamp(velocity, 0, 1) * 0.92

  return {
    level: 0.42 * velocityLevel * lowRegisterGain * sampleNormalization,
    lowRegisterGain,
  }
}
