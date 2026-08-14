import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DocumentPreviewModal } from '@/components/collab/documents/DocumentPreviewModal'
import { Icon } from '@/components/ui/Icon'
import {
  deleteMyDocument,
  downloadOfficialPdf,
  fetchMyJustificatif,
  fetchOfficialPdf,
  getMyDocuments,
  replaceMyDocument,
  triggerBlobDownload,
} from '@/services/documents'
import { getMyAbsenceDeclarations, getMyLeaveRequests } from '@/services/myRequests'
import { formatDateNumericFR, formatRangeNumericFR } from '@/utils/format'

import '@/styles/documents.css'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

const DOCUMENT_STATUS = {
  EN_ATTENTE: { label: 'En attente de vérification', tone: 'pending', icon: 'clock' },
  ACCEPTE: { label: 'Accepté', tone: 'accepted', icon: 'check' },
  REJETE: { label: 'Rejeté', tone: 'rejected', icon: 'alert' },
}

function formatFileSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return 'Taille inconnue'
  if (value < 1024) return `${value} o`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`
  return `${(value / (1024 * 1024)).toLocaleString('fr-FR', {
    maximumFractionDigits: 1,
  })} Mo`
}

function datePart(value) {
  return value ? String(value).slice(0, 10) : null
}

function contextLabel(document, leaveRequestsById, absencesById) {
  if (document.leaveRequestId) {
    const request = leaveRequestsById.get(Number(document.leaveRequestId))
    if (request) {
      return {
        title: request.leaveType?.name || 'Demande de congé',
        range: request.startDate && request.endDate
          ? formatRangeNumericFR(request.startDate, request.endDate)
          : null,
      }
    }
    return { title: 'Demande de congé', range: null }
  }

  if (document.absenceDeclarationId) {
    const declaration = absencesById.get(Number(document.absenceDeclarationId))
    if (declaration) {
      return {
        title: declaration.leaveType?.name || "Déclaration d'absence",
        range: declaration.startDate && declaration.endDate
          ? formatRangeNumericFR(declaration.startDate, declaration.endDate)
          : null,
      }
    }
    return { title: "Déclaration d'absence", range: null }
  }

  return { title: 'Document', range: null }
}

function statusMeta(status) {
  return DOCUMENT_STATUS[status] ?? {
    label: status || 'Statut inconnu',
    tone: 'neutral',
    icon: 'info',
  }
}

function LoadingState() {
  return (
    <div className="documents-list" aria-label="Chargement des documents">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="document-card document-card--skeleton" key={index} aria-hidden="true">
          <span className="document-skeleton document-skeleton--icon" />
          <div className="document-skeleton__content">
            <span className="document-skeleton document-skeleton--title" />
            <span className="document-skeleton document-skeleton--meta" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ tab }) {
  const isJustificatifs = tab === 'justificatifs'
  return (
    <div className="documents-empty">
      <span className="documents-empty__icon" aria-hidden="true">
        <Icon name={isJustificatifs ? 'file' : 'doc'} size={28} />
      </span>
      <strong>{isJustificatifs ? 'Aucun justificatif pour le moment.' : 'Aucun document PDF disponible.'}</strong>
      <p>
        {isJustificatifs
          ? 'Les justificatifs transmis avec vos absences apparaîtront ici.'
          : 'Les PDF officiels apparaissent après la validation ou l’annulation d’une demande de congé.'}
      </p>
    </div>
  )
}

function JustificatifCard({ document, context, busy, onReplace, onDelete, onPreview }) {
  const inputRef = useRef(null)
  const meta = statusMeta(document.status)
  const canManage = ['EN_ATTENTE', 'REJETE'].includes(document.status)
  const uploadedDate = datePart(document.uploadedAt)

  return (
    <article
      className="document-card document-card--clickable"
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir ${document.originalName || 'le justificatif'}`}
      onClick={() => onPreview(document)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPreview(document)
        }
      }}
    >
      <span className="document-card__icon document-card__icon--file" aria-hidden="true">
        <Icon name="file" size={21} />
      </span>

      <div className="document-card__main">
        <div className="document-card__title-row">
          <h3>{document.originalName || `Justificatif #${document.id}`}</h3>
          <span className={`document-status document-status--${meta.tone}`}>
            <Icon name={meta.icon} size={13} />
            {meta.label}
          </span>
        </div>

        <div className="document-card__context">
          <strong>{context.title}</strong>
          {context.range && <span>{context.range}</span>}
        </div>

        <div className="document-card__meta">
          <span>{formatFileSize(document.fileSize)}</span>
          {uploadedDate && <span>Déposé le {formatDateNumericFR(uploadedDate)}</span>}
        </div>

        {document.status === 'REJETE' && document.rejectionReason && (
          <div className="document-card__rejection">
            <Icon name="alert" size={15} />
            <span><strong>Motif du rejet :</strong> {document.rejectionReason}</span>
          </div>
        )}
      </div>

      <div className="document-card__actions">
        {canManage && (
          <>
            <input
              ref={inputRef}
              className="document-card__file-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onReplace(document, file)
              }}
            />
            <button
              type="button"
              className="document-action document-action--secondary"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                inputRef.current?.click()
              }}
            >
              <Icon name="refresh" size={15} />
              Remplacer
            </button>
            <button
              type="button"
              className="document-action document-action--danger"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(document)
              }}
            >
              <Icon name="trash" size={15} />
              Supprimer
            </button>
          </>
        )}
      </div>
    </article>
  )
}

function PdfCard({ document, context, busy, onDownload, onPreview }) {
  const generatedDate = datePart(document.uploadedAt)
  const isCancellation = document.documentKind === 'PDF_ANNULATION'

  return (
    <article
      className="document-card document-card--clickable"
      role="button"
      tabIndex={0}
      aria-label="Ouvrir le document PDF"
      onClick={() => onPreview(document)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPreview(document)
        }
      }}
    >
      <span className="document-card__icon document-card__icon--pdf" aria-hidden="true">
        <Icon name="doc" size={21} />
      </span>

      <div className="document-card__main">
        <div className="document-card__title-row">
          <h3>{isCancellation ? 'Annulation d’une demande validée' : 'Demande de congé validée'}</h3>
          <span className="document-status document-status--available">
            <Icon name="check" size={13} />
            Disponible
          </span>
        </div>

        <div className="document-card__context">
          <strong>{context.title}</strong>
          {context.range && <span>{context.range}</span>}
        </div>

        <div className="document-card__meta">
          {document.originalName && <span>{document.originalName}</span>}
          <span>{formatFileSize(document.fileSize)}</span>
          {generatedDate && <span>Généré le {formatDateNumericFR(generatedDate)}</span>}
        </div>
      </div>

      <div className="document-card__actions">
        <button
          type="button"
          className="document-action document-action--primary"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onDownload(document)
          }}
        >
          <Icon name="download" size={16} />
          {busy ? 'Téléchargement…' : 'Télécharger'}
        </button>
      </div>
    </article>
  )
}

export function DocumentsPage() {
  const [tab, setTab] = useState('justificatifs')
  const [state, setState] = useState({
    loading: true,
    documents: [],
    leaveRequests: [],
    absences: [],
    error: false,
    partialError: false,
  })
  const [busyId, setBusyId] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [preview, setPreview] = useState({
    document: null,
    loading: false,
    blob: null,
    blobUrl: null,
    mimeType: null,
    error: null,
  })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false, partialError: false }))

    const [documentsResult, leaveResult, absenceResult] = await Promise.allSettled([
      getMyDocuments(),
      getMyLeaveRequests(),
      getMyAbsenceDeclarations(),
    ])

    if (documentsResult.status === 'rejected') {
      setState({
        loading: false,
        documents: [],
        leaveRequests: [],
        absences: [],
        error: true,
        partialError: false,
      })
      return
    }

    setState({
      loading: false,
      documents: documentsResult.value ?? [],
      leaveRequests: leaveResult.status === 'fulfilled' ? leaveResult.value ?? [] : [],
      absences: absenceResult.status === 'fulfilled' ? absenceResult.value ?? [] : [],
      error: false,
      partialError: leaveResult.status === 'rejected' || absenceResult.status === 'rejected',
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 5000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  useEffect(() => () => {
    if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl)
  }, [preview.blobUrl])

  const leaveRequestsById = useMemo(
    () => new Map(state.leaveRequests.map((request) => [Number(request.id), request])),
    [state.leaveRequests],
  )
  const absencesById = useMemo(
    () => new Map(state.absences.map((declaration) => [Number(declaration.id), declaration])),
    [state.absences],
  )

  const justificatifs = useMemo(
    () => state.documents.filter((document) => document.documentKind === 'JUSTIFICATIF'),
    [state.documents],
  )
  const pdfs = useMemo(
    () => state.documents.filter((document) => ['PDF_VALIDATION', 'PDF_ANNULATION'].includes(document.documentKind)),
    [state.documents],
  )

  const handleReplace = async (document, file) => {
    const lowerName = file.name.toLocaleLowerCase('fr-FR')
    const validExtension = ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
    if (!ALLOWED_MIME_TYPES.has(file.type) || !validExtension) {
      setFeedback({ kind: 'error', message: 'Le fichier doit être au format PDF, JPG ou PNG.' })
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setFeedback({ kind: 'error', message: 'Le fichier dépasse la limite de 10 Mo.' })
      return
    }

    setBusyId(document.id)
    try {
      const replacement = await replaceMyDocument(document.id, file)
      setState((current) => ({
        ...current,
        documents: current.documents.map((item) => item.id === document.id ? replacement : item),
      }))
      setFeedback({ kind: 'success', message: 'Justificatif remplacé. Il est de nouveau en attente de vérification.' })
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error.response?.data?.message || error.message || 'Impossible de remplacer ce justificatif.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (document) => {
    if (!window.confirm('Supprimer ce justificatif ?')) return

    setBusyId(document.id)
    try {
      await deleteMyDocument(document.id)
      setState((current) => ({
        ...current,
        documents: current.documents.filter((item) => item.id !== document.id),
      }))
      setFeedback({ kind: 'success', message: 'Justificatif supprimé.' })
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error.response?.data?.message || error.message || 'Impossible de supprimer ce justificatif.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleDownload = async (document) => {
    setBusyId(document.id)
    try {
      await downloadOfficialPdf(document)
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error.response?.data?.message || error.message || 'Impossible de télécharger ce document.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const closePreview = useCallback(() => {
    setPreview((current) => {
      if (current.blobUrl) URL.revokeObjectURL(current.blobUrl)
      return {
        document: null,
        loading: false,
        blob: null,
        blobUrl: null,
        mimeType: null,
        error: null,
      }
    })
  }, [])

  const handlePreview = useCallback(async (document) => {
    setPreview((current) => {
      if (current.blobUrl) URL.revokeObjectURL(current.blobUrl)
      return {
        document,
        loading: true,
        blob: null,
        blobUrl: null,
        mimeType: document.mimeType || null,
        error: null,
      }
    })

    try {
      const result = document.documentKind === 'JUSTIFICATIF'
        ? await fetchMyJustificatif(document.id)
        : await fetchOfficialPdf(document)
      const blobUrl = URL.createObjectURL(result.blob)

      setPreview((current) => {
        if (current.document?.id !== document.id) {
          URL.revokeObjectURL(blobUrl)
          return current
        }
        return {
          document,
          loading: false,
          blob: result.blob,
          blobUrl,
          mimeType: result.mimeType,
          error: null,
        }
      })
    } catch (error) {
      setPreview((current) => {
        if (current.document?.id !== document.id) return current
        return {
          ...current,
          loading: false,
          error: error.response?.data?.message || error.message || 'Le fichier est momentanément indisponible.',
        }
      })
    }
  }, [])

  const handlePreviewDownload = () => {
    if (!preview.document || !preview.blob) return
    triggerBlobDownload(
      preview.blob,
      preview.document.originalName || (preview.document.documentKind === 'JUSTIFICATIF' ? 'justificatif' : 'document.pdf'),
    )
  }

  const visibleDocuments = tab === 'justificatifs' ? justificatifs : pdfs

  return (
    <section className="documents-page">
      <div className="documents-tabs" role="tablist" aria-label="Mes documents">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'justificatifs'}
          className={`documents-tab${tab === 'justificatifs' ? ' is-active' : ''}`}
          onClick={() => setTab('justificatifs')}
        >
          <Icon name="file" size={16} />
          Mes justificatifs
          <span className="documents-tab__count">{justificatifs.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pdfs'}
          className={`documents-tab${tab === 'pdfs' ? ' is-active' : ''}`}
          onClick={() => setTab('pdfs')}
        >
          <Icon name="doc" size={16} />
          Mes demandes
          <span className="documents-tab__count">{pdfs.length}</span>
        </button>
      </div>

      {feedback && (
        <div className={`documents-feedback documents-feedback--${feedback.kind}`} role="status">
          <Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fermer">×</button>
        </div>
      )}

      {state.partialError && !state.loading && (
        <div className="documents-context-warning" role="status">
          <Icon name="info" size={16} />
          <span>Certains détails liés aux demandes n’ont pas pu être chargés. Vos documents restent disponibles.</span>
        </div>
      )}

      {state.loading ? (
        <LoadingState />
      ) : state.error ? (
        <div className="documents-error" role="alert">
          <span className="documents-empty__icon" aria-hidden="true"><Icon name="alert" size={26} /></span>
          <strong>Impossible de charger vos documents</strong>
          <p>Les informations sont momentanément indisponibles.</p>
          <button type="button" onClick={load}>Réessayer</button>
        </div>
      ) : visibleDocuments.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="documents-list">
          {visibleDocuments.map((document) => {
            const context = contextLabel(document, leaveRequestsById, absencesById)
            return tab === 'justificatifs' ? (
              <JustificatifCard
                key={document.id}
                document={document}
                context={context}
                busy={busyId === document.id}
                onReplace={handleReplace}
                onDelete={handleDelete}
                onPreview={handlePreview}
              />
            ) : (
              <PdfCard
                key={document.id}
                document={document}
                context={context}
                busy={busyId === document.id}
                onDownload={handleDownload}
                onPreview={handlePreview}
              />
            )
          })}
        </div>
      )}

      {tab === 'justificatifs' && !state.loading && !state.error && (
        <p className="documents-confidentiality">
          <Icon name="shield" size={15} />
          Vous pouvez consulter vos propres justificatifs ici. Leur contenu reste confidentiel et n’est accessible qu’à vous-même et à la RH.
        </p>
      )}

      <DocumentPreviewModal
        document={preview.document}
        blobUrl={preview.blobUrl}
        mimeType={preview.mimeType}
        loading={preview.loading}
        error={preview.error}
        onClose={closePreview}
        onDownload={handlePreviewDownload}
      />
    </section>
  )
}
