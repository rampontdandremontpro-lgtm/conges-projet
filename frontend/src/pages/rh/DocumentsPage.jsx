import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { DocumentPreviewModal } from '@/components/collab/documents/DocumentPreviewModal'
import { Icon } from '@/components/ui/Icon'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { PageContainer } from '@/components/ui/PageContainer'
import {
  downloadRhDocument,
  fetchRhDocument,
  getRhDocumentLibrary,
  getRhDocumentServices,
  getRhDocumentUsers,
} from '@/services/rhDocuments'
import { formatDateNumericFR } from '@/utils/format'

import '@/styles/collab/documents/index.css'
import '@/styles/rh/documents.css'

const PAGE_SIZE = 8

const TABS = [
  { id: 'all', label: 'Tous' },
  { id: 'justificatifs', label: 'Justificatifs' },
  { id: 'conges', label: 'Congés' },
  { id: 'annulations', label: 'Annulations' },
]

const CATEGORY_BY_KIND = {
  JUSTIFICATIF: 'justificatifs',
  PDF_VALIDATION: 'conges',
  PDF_ANNULATION: 'annulations',
}

const CATEGORY_META = {
  JUSTIFICATIF: { label: 'Justificatif', tone: 'blue', icon: 'file' },
  PDF_VALIDATION: { label: 'Congé', tone: 'green', icon: 'doc' },
  PDF_ANNULATION: { label: 'Annulation', tone: 'orange', icon: 'refresh' },
}

const STATUS_META = {
  EN_ATTENTE: { label: 'En attente', tone: 'pending' },
  ACCEPTE: { label: 'Validé', tone: 'accepted' },
  REJETE: { label: 'Refusé', tone: 'rejected' },
}

function initials(employee) {
  if (!employee) return '—'
  return `${employee.prenom?.[0] ?? ''}${employee.nom?.[0] ?? ''}`.toUpperCase()
}

function employeeName(employee) {
  if (!employee) return 'Collaborateur indisponible'
  return `${employee.prenom ?? ''} ${employee.nom ?? ''}`.trim()
}

function formatFileSize(size) {
  const value = Number(size)
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1024) return `${value} o`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`
  return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}

function SkeletonRows() {
  return Array.from({ length: 5 }, (_, index) => (
    <div className="rh-documents-row rh-documents-row--body rh-documents-row--skeleton" key={index}>
      {Array.from({ length: 7 }, (_, cell) => (
        <span className="rh-documents-skeleton" key={cell} />
      ))}
    </div>
  ))
}

export function RhDocumentsPage() {
  const [searchParams] = useSearchParams()
  const search = (searchParams.get('q') ?? '').trim().toLowerCase()

  const [state, setState] = useState({
    loading: true,
    error: false,
    documents: [],
    users: [],
    services: [],
  })
  const [tab, setTab] = useState('all')
  const [serviceId, setServiceId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [status, setStatus] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState({
    document: null,
    blobUrl: null,
    mimeType: null,
    loading: false,
    error: false,
  })
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setState((current) => ({ ...current, loading: true, error: false }))
    }

    try {
      const [documents, users, services] = await Promise.all([
        getRhDocumentLibrary({
          serviceId,
          employeeId,
          status,
          startDate,
          endDate,
        }),
        getRhDocumentUsers(),
        getRhDocumentServices(),
      ])

      setState({
        loading: false,
        error: false,
        documents: Array.isArray(documents) ? documents : [],
        users: Array.isArray(users) ? users : [],
        services: Array.isArray(services) ? services : [],
      })
    } catch {
      if (!silent) {
        setState((current) => ({ ...current, loading: false, error: true }))
      }
    }
  }, [employeeId, endDate, serviceId, startDate, status])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const refresh = () => load({ silent: true })
    window.addEventListener('gmes:data-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('gmes:data-changed', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [tab, serviceId, employeeId, status, startDate, endDate, search])

  useEffect(() => () => {
    if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl)
  }, [preview.blobUrl])

  const services = useMemo(() => (
    state.services
      .filter((service) => service?.id && service?.name)
      .map((service) => ({ id: String(service.id), name: service.name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
  ), [state.services])

  const employees = useMemo(() => (
    state.users
      .filter((user) => user?.role !== 'ADMIN')
      .filter((user) => !serviceId || String(user?.service?.id ?? user?.serviceId ?? '') === serviceId)
      .sort((a, b) => (
        `${a.nom ?? ''} ${a.prenom ?? ''}`.localeCompare(
          `${b.nom ?? ''} ${b.prenom ?? ''}`,
          'fr',
        )
      ))
  ), [serviceId, state.users])

  const documentsAfterTabAndSearch = useMemo(() => (
    state.documents.filter((document) => {
      if (tab !== 'all' && CATEGORY_BY_KIND[document.documentKind] !== tab) {
        return false
      }

      if (!search) return true

      const haystack = [
        document.originalName,
        employeeName(document.employee),
        document.service?.name,
        document.source?.label,
        CATEGORY_META[document.documentKind]?.label,
      ].filter(Boolean).join(' ').toLowerCase()

      return haystack.includes(search)
    })
  ), [search, state.documents, tab])

  const counts = useMemo(() => {
    const result = {
      all: state.documents.length,
      justificatifs: 0,
      conges: 0,
      annulations: 0,
    }

    state.documents.forEach((document) => {
      const category = CATEGORY_BY_KIND[document.documentKind]
      if (category) result[category] += 1
    })

    return result
  }, [state.documents])

  const maxPage = Math.max(1, Math.ceil(documentsAfterTabAndSearch.length / PAGE_SIZE))
  const safePage = Math.min(page, maxPage)
  const pageDocuments = documentsAfterTabAndSearch.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  const resetFilters = () => {
    setServiceId('')
    setEmployeeId('')
    setStatus('')
    setStartDate('')
    setEndDate('')
  }

  const handleServiceChange = (event) => {
    setServiceId(event.target.value)
    setEmployeeId('')
  }

  const closePreview = () => {
    if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl)
    setPreview({
      document: null,
      blobUrl: null,
      mimeType: null,
      loading: false,
      error: false,
    })
  }

  const handlePreview = async (document) => {
    if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl)
    setPreview({
      document,
      blobUrl: null,
      mimeType: null,
      loading: true,
      error: false,
    })

    try {
      const result = await fetchRhDocument(document)
      const blobUrl = URL.createObjectURL(result.blob)
      setPreview({
        document,
        blobUrl,
        mimeType: result.mimeType,
        loading: false,
        error: false,
      })
    } catch {
      setPreview({
        document,
        blobUrl: null,
        mimeType: null,
        loading: false,
        error: 'Le document ne peut pas être affiché pour le moment.',
      })
    }
  }

  const handleDownload = async (document) => {
    setBusyId(document.id)
    try {
      await downloadRhDocument(document)
    } finally {
      setBusyId(null)
    }
  }

  const handlePreviewDownload = async () => {
    if (!preview.document) return
    await handleDownload(preview.document)
  }

  return (
    <PageContainer className="rh-documents-page">
      <section className="rh-documents-card">
        <div className="rh-documents-toolbar">
          <div>
            <h2>Bibliothèque documentaire</h2>
            <p>Retrouvez les justificatifs et les documents officiels générés dans GMES.</p>
          </div>

          <button type="button" className="rh-documents-reset" onClick={resetFilters}>
            <Icon name="refresh" size={15} />
            Réinitialiser
          </button>
        </div>

        <div className="rh-documents-tabs" role="tablist" aria-label="Catégories de documents">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`rh-documents-tab${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              <span>{counts[item.id]}</span>
            </button>
          ))}
        </div>

        <div className="rh-documents-filters">
          <label>
            <span>Service</span>
            <select value={serviceId} onChange={handleServiceChange}>
              <option value="">Tous les services</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Collaborateur</span>
            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">Tous les collaborateurs</option>
              {employees.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.prenom} {user.nom}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Statut</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Tous les statuts</option>
              <option value="EN_ATTENTE">En attente</option>
              <option value="ACCEPTE">Validé</option>
              <option value="REJETE">Refusé</option>
            </select>
          </label>

          <label>
            <span>Du</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>

          <label>
            <span>Au</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>

        <div className="rh-documents-table-wrap">
          <div className="rh-documents-table">
            <div className="rh-documents-row rh-documents-row--head">
              <span>Document</span>
              <span>Collaborateur</span>
              <span>Catégorie</span>
              <span>Source</span>
              <span>Date</span>
              <span>Statut</span>
              <span>Actions</span>
            </div>

            {state.loading ? (
              <SkeletonRows />
            ) : state.error ? (
              <div className="rh-documents-empty">
                <span className="rh-documents-empty__icon"><Icon name="alert" size={25} /></span>
                <strong>Impossible de charger les documents</strong>
                <p>Les archives documentaires sont momentanément indisponibles.</p>
                <button type="button" onClick={() => load()}>Réessayer</button>
              </div>
            ) : pageDocuments.length === 0 ? (
              <div className="rh-documents-empty">
                <span className="rh-documents-empty__icon"><Icon name="doc" size={25} /></span>
                <strong>Aucun document à afficher</strong>
                <p>Aucun document ne correspond aux critères sélectionnés.</p>
              </div>
            ) : (
              pageDocuments.map((document) => {
                const category = CATEGORY_META[document.documentKind] ?? CATEGORY_META.JUSTIFICATIF
                const statusMeta = STATUS_META[document.status] ?? { label: document.status, tone: 'neutral' }

                return (
                  <div
                    className="rh-documents-row rh-documents-row--body"
                    key={document.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handlePreview(document)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handlePreview(document)
                      }
                    }}
                  >
                    <div className="rh-documents-file">
                      <span className={`rh-documents-file__icon is-${category.tone}`}>
                        <Icon name={category.icon} size={17} />
                      </span>
                      <div>
                        <strong>{document.originalName || `Document #${document.id}`}</strong>
                        <small>{formatFileSize(document.fileSize)}</small>
                      </div>
                    </div>

                    <div className="rh-documents-person">
                      <span className="rh-documents-avatar">{initials(document.employee)}</span>
                      <div>
                        <strong>{employeeName(document.employee)}</strong>
                        <small>{document.service?.name ?? 'Service non renseigné'}</small>
                      </div>
                    </div>

                    <span className={`rh-documents-category is-${category.tone}`}>
                      {category.label}
                    </span>

                    <div className="rh-documents-source">
                      <strong>{document.source?.label ?? '—'}</strong>
                      {document.source?.startDate && (
                        <small>
                          {formatDateNumericFR(document.source.startDate)}
                          {document.source.endDate && document.source.endDate !== document.source.startDate
                            ? ` → ${formatDateNumericFR(document.source.endDate)}`
                            : ''}
                        </small>
                      )}
                    </div>

                    <span>{formatDateNumericFR(document.uploadedAt)}</span>

                    <span className={`rh-documents-status is-${statusMeta.tone}`}>
                      {statusMeta.label}
                    </span>

                    <div className="rh-documents-actions">
                      <button
                        type="button"
                        title="Télécharger"
                        disabled={busyId === document.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDownload(document)
                        }}
                      >
                        <Icon name="download" size={16} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {!state.loading && !state.error && documentsAfterTabAndSearch.length > 0 && (
          <div className="rh-documents-footer">
            <span>
              {documentsAfterTabAndSearch.length} document{documentsAfterTabAndSearch.length > 1 ? 's' : ''}
            </span>

            <PaginationBar
              page={safePage}
              pageSize={PAGE_SIZE}
              totalItems={documentsAfterTabAndSearch.length}
              onPageChange={setPage}
            />
          </div>
        )}
      </section>

      <DocumentPreviewModal
        document={preview.document}
        blobUrl={preview.blobUrl}
        mimeType={preview.mimeType}
        loading={preview.loading}
        error={preview.error}
        onClose={closePreview}
        onDownload={handlePreviewDownload}
      />
    </PageContainer>
  )
}
