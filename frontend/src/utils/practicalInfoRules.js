// Règles internes GMES affichées dans « Informations pratiques ».
//
// Les règles sont stockées en base (INTERNAL_RULES_JSON) et leur contenu peut
// contenir des variables {{...}} qui sont remplacées au moment de l'affichage
// par les valeurs réellement configurées des paramètres applicatifs.

const FRENCH_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

function dayLabelFR(day) {
  return day === 1 ? '1er' : String(day)
}

function monthDayLabelFR(monthDay) {
  const [month, day] = String(monthDay ?? '')
    .split('-')
    .map(Number)
  if (!month || !day || !FRENCH_MONTHS[month - 1]) return ''
  return `${dayLabelFR(day)} ${FRENCH_MONTHS[month - 1]}`
}

// Fin de la période de référence = veille du début de période suivant.
function referencePeriodEndLabel(periodStart) {
  const [month, day] = String(periodStart ?? '06-01')
    .split('-')
    .map(Number)
  if (!month || !day) return '31 mai'
  const startDate = new Date(Date.UTC(2024, month - 1, day))
  startDate.setUTCDate(startDate.getUTCDate() - 1)
  return `${dayLabelFR(startDate.getUTCDate())} ${FRENCH_MONTHS[startDate.getUTCMonth()]}`
}

function numberSetting(settings, key, fallback) {
  const raw = settings?.find((item) => item.settingKey === key)?.settingValue
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function stringSetting(settings, key, fallback) {
  const raw = settings?.find((item) => item.settingKey === key)?.settingValue
  const value = String(raw ?? '').trim()
  return value || fallback
}

// Icônes proposées dans le sélecteur (mêmes valeurs que le backend).
export const INTERNAL_RULE_ICONS = [
  { value: 'clock', label: 'Horloge' },
  { value: 'sun', label: 'Soleil' },
  { value: 'calendar', label: 'Calendrier' },
  { value: 'check', label: 'Coche' },
  { value: 'shield', label: 'Bouclier' },
  { value: 'users', label: 'Utilisateurs' },
  { value: 'info', label: 'Information' },
  { value: 'alert', label: 'Alerte' },
  { value: 'bell', label: 'Cloche' },
  { value: 'file', label: 'Fichier' },
  { value: 'doc', label: 'Document' },
  { value: 'chart', label: 'Graphique' },
  { value: 'wallet', label: 'Portefeuille' },
  { value: 'building', label: 'Bâtiment' },
  { value: 'sparkles', label: 'Étoiles' },
  { value: 'ban', label: 'Interdit' },
  { value: 'eye', label: 'Œil' },
  { value: 'settings', label: 'Paramètres' },
  { value: 'list', label: 'Liste' },
  { value: 'refresh', label: 'Actualiser' },
  { value: 'user', label: 'Personne' },
]

// Catalogue des variables utilisables dans les textes de règles.
export const INTERNAL_RULE_VARIABLES = [
  { name: 'delai_normal', label: 'Délai normal de dépôt', example: '30 jours' },
  { name: 'delai_special', label: 'Délai spécial (long séjour / été)', example: '60 jours' },
  { name: 'seuil_duree', label: 'Seuil de congé long', example: '21 jours' },
  { name: 'debut_ete', label: 'Début de la période estivale', example: '1er mai' },
  { name: 'fin_ete', label: 'Fin de la période estivale', example: '31 octobre' },
  { name: 'delai_modification', label: 'Délai de modification avant départ', example: '7 jours' },
  { name: 'debut_periode', label: 'Début de la période de référence', example: '1er juin' },
  { name: 'fin_periode', label: 'Fin de la période de référence', example: '31 mai' },
]

export function resolveVariables(settings) {
  const normal = numberSetting(settings, 'NORMAL_REQUEST_DEADLINE_DAYS', 30)
  const special = numberSetting(settings, 'SPECIAL_REQUEST_DEADLINE_DAYS', 60)
  const threshold = numberSetting(settings, 'SPECIAL_DURATION_THRESHOLD_DAYS', 21)
  const modification = numberSetting(settings, 'MODIFICATION_DEADLINE_DAYS', 7)
  const summerStart = stringSetting(settings, 'SUMMER_PERIOD_START', '05-01')
  const summerEnd = stringSetting(settings, 'SUMMER_PERIOD_END', '10-31')
  const periodStart = stringSetting(settings, 'REFERENCE_PERIOD_START', '06-01')

  return {
    delai_normal: `${normal} jours`,
    delai_special: `${special} jours`,
    seuil_duree: `${threshold} jours`,
    debut_ete: monthDayLabelFR(summerStart),
    fin_ete: monthDayLabelFR(summerEnd),
    delai_modification: `${modification} jours`,
    debut_periode: monthDayLabelFR(periodStart),
    fin_periode: referencePeriodEndLabel(periodStart),
  }
}

export function resolveRuleContent(content, settings) {
  const values = resolveVariables(settings)
  return String(content ?? '').replace(/{{([a-z_]+)}}/g, (match, name) => (
    values[name] ?? match
  ))
}

export function resolveInternalRules(rules, settings) {
  return (rules ?? []).map((rule) => ({
    ...rule,
    text: resolveRuleContent(rule.content, settings),
  }))
}

// Découpe le contenu brut en segments de texte et de valeurs automatiques.
export function segmentsFromContent(content) {
  const segments = []
  const text = String(content ?? '')
  const pattern = /{{([a-z_]+)}}/g
  let lastIndex = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'variable', key: match[1] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments
}

// Reconstruit le contenu brut (avec {{...}}) à partir des segments.
export function contentFromSegments(segments) {
  return (segments ?? [])
    .map((segment) => (segment.type === 'variable' ? `{{${segment.key}}}` : segment.value))
    .join('')
}
