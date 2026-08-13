import { useEffect } from 'react'

import { Icon } from '@/components/ui/Icon'

function isPdf(mimeType, filename) {
  return mimeType === 'application/pdf' || String(filename ?? '').toLowerCase().endsWith('.pdf')
}

function isImage(mimeType, filename) {
  return mimeType?.startsWith('image/') || /\.(png|jpe?g)$/i.test(String(filename ?? ''))
}

export function DocumentPreviewModal({
  document,
  blobUrl,
  mimeType,
  loading,
  error,
  onClose,
  onDownload,
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }

    document && window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [document, onClose])

  if (!document) return null

  const filename = document.originalName || (document.documentKind === 'JUSTIFICATIF' ? 'Justificatif' : 'Document PDF')
  const pdf = isPdf(mimeType, filename)
  const image = isImage(mimeType, filename)

  return (
    <div className="document-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="document-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="document-preview-header">
          <div className="document-preview-header__identity">
            <span className="document-preview-header__icon" aria-hidden="true">
              <Icon name={pdf ? 'doc' : 'file'} size={20} />
            </span>
            <div>
              <span className="document-preview-header__eyebrow">
                {document.documentKind === 'JUSTIFICATIF' ? 'Justificatif' : 'Document officiel'}
              </span>
              <h2 id="document-preview-title">{filename}</h2>
            </div>
          </div>

          <button type="button" className="document-preview-close" onClick={onClose} aria-label="Fermer l’aperçu">
            ×
          </button>
        </header>

        <div className="document-preview-body">
          {loading ? (
            <div className="document-preview-state" aria-busy="true">
              <span className="document-preview-loader" />
              <strong>Chargement du document…</strong>
            </div>
          ) : error ? (
            <div className="document-preview-state document-preview-state--error" role="alert">
              <Icon name="alert" size={28} />
              <strong>Impossible d’afficher ce document</strong>
              <p>{error}</p>
            </div>
          ) : pdf && blobUrl ? (
            <iframe className="document-preview-frame" src={blobUrl} title={`Aperçu de ${filename}`} />
          ) : image && blobUrl ? (
            <div className="document-preview-image-wrap">
              <img className="document-preview-image" src={blobUrl} alt={`Aperçu de ${filename}`} />
            </div>
          ) : blobUrl ? (
            <div className="document-preview-state">
              <Icon name="file" size={34} />
              <strong>Aperçu non disponible pour ce format</strong>
              <p>Vous pouvez tout de même télécharger le fichier.</p>
            </div>
          ) : null}
        </div>

        <footer className="document-preview-footer">
          <button type="button" className="document-preview-button document-preview-button--secondary" onClick={onClose}>
            Fermer
          </button>
          <button
            type="button"
            className="document-preview-button document-preview-button--primary"
            disabled={loading || Boolean(error) || !blobUrl}
            onClick={onDownload}
          >
            <Icon name="download" size={16} />
            Télécharger
          </button>
        </footer>
      </section>
    </div>
  )
}
