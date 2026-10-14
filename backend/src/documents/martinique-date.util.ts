/**
 * Formatage des horaires des documents PDF dans le fuseau officiel de la
 * Martinique (UTC−4, sans changement d'heure).
 *
 * Les timestamps sont stockés en base au format UTC. Ces helpers convertissent
 * une seule fois la valeur réelle vers America/Martinique : ils ne retranchent
 * jamais un décalage à une chaîne déjà formatée.
 */

const MARTINIQUE_TIME_ZONE = 'America/Martinique';

export function formatMartiniqueDateTime(
  dateValue: Date | string | null | undefined,
): string {
  if (!dateValue) {
    return 'Non renseigné';
  }

  const date =
    dateValue instanceof Date ? dateValue : new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return 'Non renseigné';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: MARTINIQUE_TIME_ZONE,
  }).format(date);
}

/**
 * Formate une date seule (YYYY-MM-DD) sans conversion de fuseau : les
 * composants jour/mois/année sont utilisés tels quels. Les dates de congé ne
 * doivent jamais être décalées par une conversion UTC -> Martinique.
 */
export function formatMartiniqueDateOnly(dateValue: string): string {
  const [year, month, day] = String(dateValue ?? '')
    .split('-')
    .map((value) => Number(value));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return String(dateValue ?? '—');
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
