import { Icon } from '@/components/ui/Icon'

import '@/styles/components/pagination.css'

export function PaginationBar({ page, pageSize, totalItems, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  if (totalItems <= pageSize) return null

  const safePage = Math.min(Math.max(page, 1), totalPages)
  const start = ((safePage - 1) * pageSize) + 1
  const end = Math.min(safePage * pageSize, totalItems)

  return (
    <nav className="gmes-pagination" aria-label="Pagination">
      <span className="gmes-pagination__range">{start}–{end} sur {totalItems}</span>
      <span className="gmes-pagination__separator" aria-hidden="true" />
      <span className="gmes-pagination__page">Page {safePage} / {totalPages}</span>
      <div className="gmes-pagination__actions">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage === 1}
          aria-label="Page précédente"
          title="Page précédente"
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage === totalPages}
          aria-label="Page suivante"
          title="Page suivante"
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </nav>
  )
}
