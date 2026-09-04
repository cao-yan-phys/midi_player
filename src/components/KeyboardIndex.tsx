import { useMemo } from 'react'
import { keyboardBindingsForOctaveLevel } from '../playback/keyboardMap'

interface KeyboardIndexProps {
  octaveLevel: number
  pressedCodes: ReadonlySet<string>
}

const LOW_REGISTER_CODES = new Set([
  'KeyZ',
  'KeyX',
  'KeyC',
  'KeyV',
  'KeyB',
  'KeyN',
  'KeyM',
  'KeyA',
  'KeyW',
  'KeyS',
  'KeyE',
  'KeyD',
  'KeyF',
  'KeyT',
])

const VIOLIN_OPEN_STRING_PITCHES = new Set([55, 62, 69, 76])

export function KeyboardIndex({
  octaveLevel,
  pressedCodes,
}: KeyboardIndexProps) {
  const columns = useMemo(() => {
    const bindings = keyboardBindingsForOctaveLevel(octaveLevel)

    return [
      bindings.filter((binding) => LOW_REGISTER_CODES.has(binding.code)),
      bindings.filter((binding) => !LOW_REGISTER_CODES.has(binding.code)),
    ]
  }, [octaveLevel])

  return (
    <aside className="keyboard-index" aria-label="Keyboard note map">
      <div className="keyboard-index__levels" aria-label="Octave level">
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            className={level === octaveLevel ? 'is-active' : undefined}
            key={level}
          >
            {level}
          </span>
        ))}
      </div>
      <div className="keyboard-index__columns">
        {columns.map((column, index) => (
          <div className="keyboard-index__column" key={index}>
            {column.map((binding) => {
              const isActive = pressedCodes.has(binding.code)
              const isViolinOpenString =
                binding.pitch !== undefined &&
                VIOLIN_OPEN_STRING_PITCHES.has(binding.pitch)

              return (
                <div
                  className={
                    [
                      'keyboard-index__entry',
                      isActive ? 'is-active' : '',
                      isViolinOpenString ? 'is-violin-open-string' : '',
                      binding.isPlayable ? '' : 'is-unavailable',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  }
                  key={binding.code}
                >
                  <kbd>{binding.label}</kbd>
                  <span>{binding.pitchName}</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}
