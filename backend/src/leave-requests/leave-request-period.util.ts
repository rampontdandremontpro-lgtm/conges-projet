import { DayPeriod } from './leave-request.entity';

/**
 * Utilitaire partagé des périodes MATIN / APRES_MIDI.
 *
 * Source unique de vérité pour :
 *  - déterminer si un congé ou une absence couvre un slot donné
 *    (occupiesSlot) — utilisé par ServiceAvailabilityService (présence
 *    minimale) et PresenceService (statut par slot) ;
 *  - déterminer le slot courant (getCurrentDayPeriod) à partir de
 *    l'heure America/Martinique et du paramètre AFTERNOON_START_HOUR.
 *
 * AUCUNE règle de demi-journée n'est dupliquée ailleurs dans le backend.
 */

export interface PeriodCoverageItem {
  startDate: string;
  endDate: string;
  startPeriod: DayPeriod | null;
  endPeriod: DayPeriod | null;
}

/**
 * Un congé / une absence couvre-t-il le slot (date, période) donné ?
 *
 * Règles (préservées de l'historique) :
 *  - même jour MATIN→MATIN          : MATIN seulement ;
 *  - même jour APRES_MIDI→APRES_MIDI : APRES_MIDI seulement ;
 *  - même jour MATIN→APRES_MIDI      : journée complète (les deux) ;
 *  - premier jour, début MATIN       : les deux slots ;
 *  - premier jour, début APRES_MIDI  : APRES_MIDI seulement ;
 *  - dernier jour, fin APRES_MIDI    : les deux slots ;
 *  - dernier jour, fin MATIN         : MATIN seulement ;
 *  - jours intermédiaires            : les deux slots.
 *
 * Combinaison APRES_MIDI→MATIN sur une même date : INVALUDE (bloquée par
 * les validations de création/modification des congés et des absences).
 * Défensivement, elle ne couvre aucun slot (jamais « journée complète »).
 */
export function occupiesSlot(
  item: PeriodCoverageItem,
  date: string,
  period: DayPeriod,
): boolean {
  if (date < item.startDate || date > item.endDate) {
    return false;
  }

  const startPeriod = item.startPeriod ?? DayPeriod.MATIN;
  const endPeriod = item.endPeriod ?? DayPeriod.APRES_MIDI;

  if (item.startDate === item.endDate) {
    if (
      startPeriod === DayPeriod.APRES_MIDI &&
      endPeriod === DayPeriod.MATIN
    ) {
      // Combinaison invalide : aucune couverture de slot.
      return false;
    }

    if (
      startPeriod === DayPeriod.APRES_MIDI &&
      endPeriod === DayPeriod.APRES_MIDI
    ) {
      return period === DayPeriod.APRES_MIDI;
    }

    if (
      startPeriod === DayPeriod.MATIN &&
      endPeriod === DayPeriod.MATIN
    ) {
      return period === DayPeriod.MATIN;
    }

    return true;
  }

  if (date === item.startDate) {
    return (
      startPeriod === DayPeriod.MATIN ||
      period === DayPeriod.APRES_MIDI
    );
  }

  if (date === item.endDate) {
    return (
      endPeriod === DayPeriod.APRES_MIDI ||
      period === DayPeriod.MATIN
    );
  }

  return true;
}

/**
 * Détermine le slot courant à partir d'un instant donné (fuseau
 * America/Martinique) et de l'heure de début de l'après-midi.
 *
 * Règle métier validée :
 *  - heure <  AFTERNOON_START_HOUR → MATIN ;
 *  - heure >= AFTERNOON_START_HOUR → APRES_MIDI.
 *
 * La comparaison s'effectue sur des chaînes 'HH:MM' zéro-paddées (ordre
 * lexicographique = ordre chronologique). Ne dépend jamais du fuseau local
 * du serveur.
 */
export function getCurrentDayPeriod(
  now: Date,
  afternoonStartHour: string,
): DayPeriod {
  const currentTime = getMartiniqueTimeString(now);
  return currentTime < afternoonStartHour
    ? DayPeriod.MATIN
    : DayPeriod.APRES_MIDI;
}

/** Date 'YYYY-MM-DD' courante en America/Martinique pour un instant donné. */
export function getMartiniqueDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Martinique',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Prochaine bascule de période (MATIN ↔ APRES_MIDI) en America/Martinique.
 *
 * La planification de la maintenance de bascule utilise la valeur du
 * paramètre AFTERNOON_START_HOUR (jamais de cron hardcodé) :
 *  - slot courant MATIN       → prochaine bascule aujourd'hui à
 *                                AFTERNOON_START_HOUR (passage APRES_MIDI) ;
 *  - slot courant APRES_MIDI  → prochaine bascule demain à 00:00 (retour
 *                                MATIN) — même mécanisme, par symétrie.
 *
 * America/Martinique = UTC−4 fixe (pas d'heure d'été) : l'instant retourné
 * est exprimé avec le décalage -04:00. Ne dépend jamais du fuseau local
 * du serveur ni de l'heure réelle d'exécution (le paramètre `now` est
 * injectable).
 */
export function getNextPeriodSwitch(
  now: Date,
  afternoonStartHour: string,
  timeZone = 'America/Martinique',
): Date {
  if (timeZone !== 'America/Martinique') {
    throw new Error(
      'Seul le fuseau America/Martinique (UTC−4 fixe) est pris en charge.',
    );
  }

  const currentDate = getMartiniqueDateString(now);
  const period = getCurrentDayPeriod(now, afternoonStartHour);

  if (period === DayPeriod.APRES_MIDI) {
    const nextDay = new Date(`${currentDate}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return new Date(
      `${nextDay.toISOString().slice(0, 10)}T00:00:00.000-04:00`,
    );
  }

  return new Date(`${currentDate}T${afternoonStartHour}:00.000-04:00`);
}

/** Heure 'HH:MM' courante en America/Martinique pour un instant donné. */
export function getMartiniqueTimeString(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Martinique',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute =
    parts.find((part) => part.type === 'minute')?.value ?? '00';

  return `${hour}:${minute}`;
}

/**
 * Heure 'HH:MM:SS' courante en America/Martinique pour un instant donné.
 * Utilisée par les tests pour détecter la fenêtre de fin de journée.
 */
export function getMartiniqueTimeWithSeconds(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Martinique',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute =
    parts.find((part) => part.type === 'minute')?.value ?? '00';
  const second =
    parts.find((part) => part.type === 'second')?.value ?? '00';

  return `${hour}:${minute}:${second}`;
}
