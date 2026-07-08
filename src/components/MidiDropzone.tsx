import { FileText, Music2, RotateCcw, Upload } from 'lucide-react'

interface MidiDropzoneProps {
  accept: string
  defaultFileName?: string
  emptyHint: string
  emptyLabel: string
  fileName: string | null
  isActive: boolean
  isSupportedFile: (file: File) => boolean
  kind: 'midi' | 'csv'
  noteCount: number
  onFile: (file: File) => void
  onLoadDefault?: () => void
}

export function MidiDropzone({
  accept,
  defaultFileName,
  emptyHint,
  emptyLabel,
  fileName,
  isActive,
  isSupportedFile,
  kind,
  noteCount,
  onFile,
  onLoadDefault,
}: MidiDropzoneProps) {
  const handleFiles = (files: FileList | null) => {
    const file = files?.[0]

    if (file && isSupportedFile(file)) {
      onFile(file)
    }
  }

  const LoadedIcon = kind === 'csv' ? FileText : Music2
  const displayName = fileName ?? defaultFileName ?? emptyLabel
  const showLoadedIcon = Boolean(fileName ?? defaultFileName)

  return (
    <div className="dropzone-wrap">
      <label
        className={isActive ? 'dropzone is-active' : 'dropzone'}
        onDragOver={(event) => {
          event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          handleFiles(event.dataTransfer.files)
        }}
      >
        <input
          type="file"
          accept={accept}
          onChange={(event) => handleFiles(event.currentTarget.files)}
        />
        <span className="dropzone__icon" aria-hidden="true">
          {showLoadedIcon ? <LoadedIcon size={18} /> : <Upload size={18} />}
        </span>
        <span className="dropzone__text">
          <strong>{displayName}</strong>
          <small>{fileName ? `${noteCount} notes` : emptyHint}</small>
        </span>
      </label>
      {defaultFileName && onLoadDefault ? (
        <button
          className="icon-button compact-button dropzone-reset"
          type="button"
          title={`Load ${defaultFileName}`}
          aria-label={`Load ${defaultFileName}`}
          onClick={onLoadDefault}
        >
          <RotateCcw size={13} />
        </button>
      ) : null}
    </div>
  )
}
