import { getLeaveRequestStatusMeta } from '@/config/leaveMeta'

export function StatusBadge({ status }) {
  const meta = getLeaveRequestStatusMeta(status)
  return (
    <span className={`status-badge status-badge--${meta.tone}`}>
      {meta.label}
    </span>
  )
}
