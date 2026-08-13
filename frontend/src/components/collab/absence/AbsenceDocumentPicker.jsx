import { useRef } from 'react'

import { Icon } from '@/components/ui/Icon'

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}

export function AbsenceDocumentPicker({
  required,
  canAddLater,
  pendingFiles,
  uploadedDocuments,
  onFiles,
  onRemovePending,
  onRemoveUploaded,
  disabled,
}) {
  const inputRef = useRef(null)
  const totalCount = pendingFiles.length + uploadedDocuments.length

  return (
    <section className="absence-card absence-document-card">
      <div className="absence-card__heading absence-card__heading--row">
        <div>
          <span className="absence-card__eyebrow">Étape 3</span>
          <h2>Justificatif</h2>
          <p>
            {required
              ? canAddLater
                ? 'Le justificatif est obligatoire, mais vous pouvez aussi le transmettre plus tard.'
                : 'Le justificatif doit être ajouté avant la transmission.'
              : 'Vous pouvez joindre un document si nécessaire.'}
          </p>
        </div>
        <span className={`absence-requirement${required ? ' is-required' : ''}`}>
          {required ? 'Obligatoire' : 'Facultatif'}
        </span>
      </div>

      <input
        ref={inputRef}
        className="absence-file-input"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        multiple
        disabled={disabled || totalCount >= 5}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />

      <button
        type="button"
        className="absence-dropzone"
        disabled={disabled || totalCount >= 5}
        onClick={() => inputRef.current?.click()}
      >
        <span className="absence-dropzone__icon">
          <Icon name="file" size={24} />
        </span>
        <span className="absence-dropzone__text">
          <strong>Ajouter un justificatif</strong>
          <small>PDF, JPG ou PNG · 10 Mo maximum · 5 fichiers maximum</small>
        </span>
        <span className="absence-dropzone__action">Parcourir</span>
      </button>

      {(pendingFiles.length > 0 || uploadedDocuments.length > 0) && (
        <div className="absence-file-list">
          {uploadedDocuments.map((document) => (
            <div className="absence-file-row" key={`uploaded-${document.id}`}>
              <span className="absence-file-row__icon">
                <Icon name="check" size={15} />
              </span>
              <span className="absence-file-row__name">
                <strong>{document.originalName || `Justificatif ${document.id}`}</strong>
                <small>Enregistré · {fileSize(Number(document.fileSize))}</small>
              </span>
              <button
                type="button"
                className="absence-file-row__remove"
                aria-label={`Supprimer ${document.originalName || 'le justificatif'}`}
                disabled={disabled}
                onClick={() => onRemoveUploaded(document)}
              >
                ×
              </button>
            </div>
          ))}

          {pendingFiles.map((file, index) => (
            <div className="absence-file-row" key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span className="absence-file-row__icon absence-file-row__icon--pending">
                <Icon name="clock" size={15} />
              </span>
              <span className="absence-file-row__name">
                <strong>{file.name}</strong>
                <small>À enregistrer · {fileSize(file.size)}</small>
              </span>
              <button
                type="button"
                className="absence-file-row__remove"
                aria-label={`Retirer ${file.name}`}
                disabled={disabled}
                onClick={() => onRemovePending(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="absence-confidentiality">
        <Icon name="shield" size={17} />
        <span>Le contenu de vos justificatifs est consultable uniquement par la RH.</span>
      </div>
    </section>
  )
}
