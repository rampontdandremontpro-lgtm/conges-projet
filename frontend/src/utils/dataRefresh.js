export function notifyAppDataChanged(detail = {}) {
  window.dispatchEvent(new CustomEvent('gmes:data-changed', { detail }))
}
