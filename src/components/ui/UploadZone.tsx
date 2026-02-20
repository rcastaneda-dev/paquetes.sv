'use client';

import { useState, useRef, useCallback } from 'react';

interface UploadZoneProps {
  id: string;
  accept: string;
  disabled?: boolean;
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  helpText?: string;
  sampleDownloadHref?: string;
  sampleDownloadLabel?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({
  id,
  accept,
  disabled = false,
  onFileSelect,
  selectedFile,
  helpText,
  sampleDownloadHref,
  sampleDownloadLabel,
}: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [disabled, onFileSelect]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleClick = useCallback(() => {
    if (!disabled) {
      inputRef.current?.click();
    }
  }, [disabled]);

  const handleChangeFile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  }, []);

  const zoneClasses = [
    'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
    isDragOver && !disabled
      ? 'border-primary bg-primary/5'
      : 'border-input hover:border-primary/50',
  ].join(' ');

  return (
    <div className="space-y-2">
      <div
        className={zoneClasses}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label="Zona de carga de archivo"
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={handleInputChange}
          className="hidden"
        />

        {selectedFile ? (
          <div className="flex flex-col items-center gap-3">
            {/* Document icon */}
            <div className="text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div>
              <p className="text-pretty text-sm font-medium">{selectedFile.name}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleChangeFile}
              className="text-sm font-medium text-primary hover:underline"
            >
              Cambiar archivo
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {/* Cloud upload icon */}
            <div className="text-muted-foreground">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                <path d="M12 12v9" />
                <path d="m16 16-4-4-4 4" />
              </svg>
            </div>
            <div>
              <p className="text-pretty text-sm font-medium">Arrastra tu archivo CSV aquí</p>
              <p className="text-pretty text-xs text-muted-foreground">
                o haz clic para seleccionar
              </p>
            </div>
          </div>
        )}
      </div>

      {(helpText || sampleDownloadHref) && (
        <p className="text-pretty text-xs text-muted-foreground">
          {helpText}
          {sampleDownloadHref && (
            <>
              {helpText ? ' ' : ''}
              <a
                href={sampleDownloadHref}
                download
                className="font-medium text-primary underline hover:text-primary/80"
                onClick={e => e.stopPropagation()}
              >
                {sampleDownloadLabel || 'Descargar archivo de ejemplo'}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
