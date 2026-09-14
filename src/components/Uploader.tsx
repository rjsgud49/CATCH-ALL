import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'

type Props = {
  disabled?: boolean
  onFiles: (files: File[]) => void
}

function filterImages(list: FileList | File[]): File[] {
  return Array.from(list).filter((f) => f.type.startsWith('image/'))
}

export function Uploader({ disabled, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: File[]) => {
    if (!files.length || disabled) return
    onFiles(files)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(filterImages(e.target.files))
    e.target.value = ''
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) handleFiles(filterImages(e.dataTransfer.files))
  }

  return (
    <div
      className={`uploader ${dragging ? 'uploader--active' : ''} ${disabled ? 'uploader--disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={disabled}
        onChange={onChange}
      />
      <button
        type="button"
        className="cta"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        수집하기
      </button>
      <p className="uploader-hint">여러 장 OK · 화면 어디에든 드롭</p>
    </div>
  )
}
