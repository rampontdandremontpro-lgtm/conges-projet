/**
 * JUR-027 — Lot L2 : moteur de calcul des échéances légales (module PUR).
 *
 * Aucune base de données, aucune dépendance aux services métier, aucune
 * écriture. `computeCarryoverExpiry` est déterministe dès lors que `today`
 * est fourni. Aucune date n'est inventée.
 *
 * Garde-fous de sécurité :
 *  - une échéance n'est OPPOSABLE (peut faire expirer un droit) que si la
 *    réception de l'information est confirmée à date certaine
 *    (`informationDateCertain === true`) ; sinon, seule une échéance
 *    INDICATIVE est retournée et le statut est `A_VERIFIER` ;
 *  - la situation d'absence est explicite (`absenceStatus`) : une date de
 *    reprise absente ou invalide n'est JAMAIS interprétée comme « toujours
 *    absent » ;
 *  - le régime ARRET_LONG exige la validation des DEUX conditions L3141-19-2
 *    (congés acquis pendant les périodes L3141-5 5°/7° ET suspension ≥ 1 an à
 *    la fin de la période de référence).
 */
import {
  AbsenceStatus,
  CarryoverDelayStatus,
  CarryoverEvent,
  CarryoverExpiryInput,
  CarryoverExpiryResult,
  CarryoverRegime,
  CarryoverSuspensionInfo,
  LEGAL_CARRYOVER_MONTHS,
} from './carryover-expiry.types';
import {
  addDays,
  addMonthsClamp,
  compareDates,
  daysBetween,
  isValidDateString,
} from './carryover-expiry.util';

const MSG_INFO_MISSING =
  'Date de réception des informations obligatoires (L3141-19-3)';
const MSG_INFO_MISSING_SUSPENSION =
  'Date de réception des informations obligatoires (L3141-19-3) — nécessaire pour lever la suspension';
const MSG_INFO_NOT_CERTAIN_FALSE =
  'Réception à date certaine non confirmée (L3141-19-3) : échéance indicative uniquement, non opposable';
const MSG_INFO_NOT_CERTAIN_UNKNOWN =
  'Réception à date certaine non renseignée (L3141-19-3) : échéance indicative uniquement, non opposable';
const MSG_INFO_BEFORE_REPRISE =
  'Incohérence : date d’information antérieure à la date de reprise';
const MSG_ABSENT_WITH_REPRISE =
  'Incohérence : statut « toujours absent » mais une date de reprise est fournie';
const MSG_REPRIS_NO_DATE =
  'Statut « repris » sans date de reprise fiable';
const MSG_ABSENCE_UNKNOWN =
  'Situation de reprise inconnue : préciser « toujours absent » (ABSENT) ou « repris » (REPRIS)';
const MSG_REPRISE_BEFORE_REF_END =
  'Incohérence : reprise antérieure à la fin de la période de référence (condition L3141-19-2 non satisfaite)';
const MSG_ABSENT_WITH_INFO =
  'Incohérence : salarié toujours absent mais une information post-reprise est fournie';

interface FieldState {
  raw: string | null;
  isNull: boolean;
  isInvalid: boolean;
  valid: boolean;
}

function classify(value: unknown): FieldState {
  if (value == null || value === '') {
    return { raw: null, isNull: true, isInvalid: false, valid: false };
  }
  const s = String(value);
  if (isValidDateString(s)) {
    return { raw: s, isNull: false, isInvalid: false, valid: true };
  }
  return { raw: s, isNull: false, isInvalid: true, valid: false };
}

function invalidDateMessage(field: string, raw: string): string {
  return `Date invalide (${field}) : « ${raw} »`;
}

type AbsenceResolution =
  | { ok: true; absenceStatus: AbsenceStatus; inferred: boolean }
  | { ok: false; messages: string[] };

/** Résout la situation d'absence explicitement, sans jamais déduire « absent ». */
function resolveAbsence(input: CarryoverExpiryInput, reprise: FieldState): AbsenceResolution {
  const status: AbsenceStatus = input.absenceStatus ?? 'INCONNU';
  if (status === 'ABSENT') {
    if (reprise.isInvalid) {
      return { ok: false, messages: [invalidDateMessage('reprise', reprise.raw ?? '')] };
    }
    if (reprise.valid) {
      return { ok: false, messages: [MSG_ABSENT_WITH_REPRISE] };
    }
    return { ok: true, absenceStatus: 'ABSENT', inferred: false };
  }
  if (status === 'REPRIS') {
    if (reprise.valid) return { ok: true, absenceStatus: 'REPRIS', inferred: false };
    if (reprise.isNull) return { ok: false, messages: [MSG_REPRIS_NO_DATE] };
    return { ok: false, messages: [invalidDateMessage('reprise', reprise.raw ?? '')] };
  }
  // INCONNU (ou non renseigné)
  if (reprise.valid) {
    return { ok: true, absenceStatus: 'REPRIS', inferred: true };
  }
  if (reprise.isNull) {
    return { ok: false, messages: [MSG_ABSENCE_UNKNOWN] };
  }
  return { ok: false, messages: [invalidDateMessage('reprise', reprise.raw ?? '')] };
}

/**
 * Résolution « souple » pour GENERAL : la situation d'absence n'est pas
 * bloquante (l'échéance dépend de la date d'information), sauf date de
 * reprise invalide ou incohérence explicite.
 */
function resolveAbsenceForGeneral(
  input: CarryoverExpiryInput,
  reprise: FieldState,
  result: CarryoverExpiryResult,
): AbsenceStatus | null {
  const status: AbsenceStatus = input.absenceStatus ?? 'INCONNU';
  if (reprise.isInvalid) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(invalidDateMessage('reprise', reprise.raw ?? ''));
    return null;
  }
  if (status === 'ABSENT') {
    if (reprise.valid) {
      result.status = CarryoverDelayStatus.A_VERIFIER;
      result.missingInformation.push(MSG_ABSENT_WITH_REPRISE);
      return null;
    }
    return 'ABSENT';
  }
  if (status === 'REPRIS') {
    if (reprise.valid) return 'REPRIS';
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(
      reprise.isNull ? MSG_REPRIS_NO_DATE : invalidDateMessage('reprise', reprise.raw ?? ''),
    );
    return null;
  }
  // INCONNU (ou non renseigné)
  if (reprise.valid) {
    result.warnings.push(
      'Situation d’absence non renseignée : « repris » déduit de la date de reprise.',
    );
    return 'REPRIS';
  }
  result.warnings.push(
    'Situation de reprise non renseignée (sans incidence sur l’échéance du régime général, fondée sur la date d’information).',
  );
  return 'INCONNU';
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

function legalBasis(regime: CarryoverRegime, monthsApplied: number): string {
  const base = regime === 'ARRET_LONG' ? 'L3141-19-2' : 'L3141-19-1';
  return monthsApplied > LEGAL_CARRYOVER_MONTHS
    ? `${base} + L3141-21-1`
    : base;
}

function simpleDelayStatus(
  startedAt: string,
  deadline: string,
  today: string,
): CarryoverDelayStatus {
  if (compareDates(today, startedAt) < 0) return CarryoverDelayStatus.EN_ATTENTE;
  if (compareDates(today, deadline) <= 0) return CarryoverDelayStatus.EN_COURS;
  return CarryoverDelayStatus.EXPIRE;
}

function baseResult(
  input: CarryoverExpiryInput,
  monthsApplied: number,
): CarryoverExpiryResult {
  return {
    regime: input.regime,
    status: CarryoverDelayStatus.A_VERIFIER,
    startDate: null,
    deadline: null,
    effectiveExpiresAt: null,
    indicativeExpiresAt: null,
    suspension: null,
    absenceStatus: null,
    events: [],
    missingInformation: [],
    warnings: [],
    legalBasis: legalBasis(input.regime, monthsApplied),
    monthsApplied,
  };
}

function resolveMonths(
  input: CarryoverExpiryInput,
  result: CarryoverExpiryResult,
): number {
  const requested = input.carryoverMonths;
  if (requested == null) return LEGAL_CARRYOVER_MONTHS;
  const value = Number(requested);
  if (!Number.isInteger(value) || value < 0) {
    result.warnings.push(
      `Durée de report invalide (« ${String(requested)} ») : socle légal de ${LEGAL_CARRYOVER_MONTHS} mois appliqué.`,
    );
    return LEGAL_CARRYOVER_MONTHS;
  }
  if (value > LEGAL_CARRYOVER_MONTHS) {
    result.warnings.push(
      `Durée conventionnelle plus favorable appliquée (L3141-21-1) : ${value} mois.`,
    );
    return value;
  }
  if (value < LEGAL_CARRYOVER_MONTHS) {
    result.warnings.push(
      `Durée configurée (${value} mois) inférieure au socle légal de ${LEGAL_CARRYOVER_MONTHS} mois : socle légal appliqué.`,
    );
    return LEGAL_CARRYOVER_MONTHS;
  }
  return value;
}

function resolveToday(input: CarryoverExpiryInput, result: CarryoverExpiryResult): string {
  if (input.today == null || input.today === '') return todayIso();
  const t = classify(input.today);
  if (t.valid) return t.raw ?? '';
  result.warnings.push(
    invalidDateMessage('date de référence du calcul (today)', t.raw ?? '') +
      ' — date du jour utilisée.',
  );
  return todayIso();
}

/** Vérifie les deux conditions L3141-19-2. Retourne false si une condition manque. */
function validateArretLongConditions(
  input: CarryoverExpiryInput,
  result: CarryoverExpiryResult,
): boolean {
  const acquired = input.acquiredDuringL3141_5_5or7;
  const suspended = input.suspensionAtLeastOneYearAtPeriodEnd;
  const messages: string[] = [];
  if (acquired !== true) {
    messages.push(
      acquired === false
        ? 'Condition L3141-19-2 non satisfaite : congés non acquis pendant les périodes L3141-5 (5° ou 7°).'
        : 'Condition L3141-19-2 non renseignée : congés acquis pendant les périodes L3141-5 (5° ou 7°).',
    );
  }
  if (suspended !== true) {
    messages.push(
      suspended === false
        ? 'Condition L3141-19-2 non satisfaite : suspension du contrat inférieure à un an à la fin de la période de référence.'
        : 'Condition L3141-19-2 non renseignée : suspension du contrat d’au moins un an à la fin de la période de référence.',
    );
  }
  if (messages.length > 0) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(...messages);
    return false;
  }
  return true;
}

function computeGeneral(
  input: CarryoverExpiryInput,
  today: string,
  result: CarryoverExpiryResult,
): CarryoverExpiryResult {
  const monthsApplied = result.monthsApplied;
  const info = classify(input.informationDate);
  const reprise = classify(input.repriseDate);
  const absenceStatus = resolveAbsenceForGeneral(input, reprise, result);
  if (absenceStatus === null) return result;
  result.absenceStatus = absenceStatus;

  if (absenceStatus === 'ABSENT') {
    if (info.valid || info.isInvalid) {
      result.status = CarryoverDelayStatus.A_VERIFIER;
      result.missingInformation.push(MSG_ABSENT_WITH_INFO);
      if (info.isInvalid) {
        result.missingInformation.push(invalidDateMessage('information', info.raw ?? ''));
      }
      return result;
    }
    // Toujours absent, aucune information reçue : délai non démarré.
    result.status = CarryoverDelayStatus.EN_ATTENTE;
    result.events.push({
      date: null,
      label:
        'Salarié toujours absent : le délai démarrera à la réception des informations après reprise (L3141-19-3).',
    });
    return result;
  }

  if (info.isNull) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.events.push({
      date: null,
      label: 'Date de réception des informations obligatoires absente : échéance non calculable.',
    });
    result.missingInformation.push(MSG_INFO_MISSING);
    return result;
  }
  if (info.isInvalid) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(invalidDateMessage('information', info.raw ?? ''));
    return result;
  }

  if (reprise.valid && compareDates(info.raw ?? '', reprise.raw ?? '') < 0) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(MSG_INFO_BEFORE_REPRISE);
    return result;
  }

  const deadline = addMonthsClamp(info.raw ?? '', monthsApplied);
  result.startDate = info.raw;
  result.deadline = deadline;
  if (reprise.valid) {
    result.events.push({ date: reprise.raw, label: 'Reprise du travail.' });
  }
  result.events.push({
    date: info.raw,
    label: 'Réception des informations obligatoires (L3141-19-3) — point de départ.',
  });
  result.events.push({
    date: deadline,
    label: `Échéance = date d’information + ${monthsApplied} mois.`,
  });

  if (input.informationDateCertain === true) {
    result.effectiveExpiresAt = deadline;
    result.status = simpleDelayStatus(info.raw ?? '', deadline, today);
  } else {
    result.indicativeExpiresAt = deadline;
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(
      input.informationDateCertain === false
        ? MSG_INFO_NOT_CERTAIN_FALSE
        : MSG_INFO_NOT_CERTAIN_UNKNOWN,
    );
  }
  result.legalBasis = legalBasis('GENERAL', monthsApplied);
  return result;
}

function computeArretLong(
  input: CarryoverExpiryInput,
  today: string,
  result: CarryoverExpiryResult,
): CarryoverExpiryResult {
  const monthsApplied = result.monthsApplied;
  const refEnd = classify(input.referencePeriodEnd);
  const reprise = classify(input.repriseDate);
  const info = classify(input.informationDate);

  if (refEnd.isNull) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(
      "Fin de la période de référence d'acquisition (L3141-19-2)",
    );
    return result;
  }
  if (refEnd.isInvalid) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(
      invalidDateMessage('fin de période de référence', refEnd.raw ?? ''),
    );
    return result;
  }

  if (!validateArretLongConditions(input, result)) {
    result.startDate = refEnd.raw;
    result.deadline = addMonthsClamp(refEnd.raw ?? '', monthsApplied);
    result.indicativeExpiresAt = result.deadline;
    result.events.push({
      date: refEnd.raw,
      label: 'Fin de la période de référence d’acquisition.',
    });
    return result;
  }

  const base = addMonthsClamp(refEnd.raw ?? '', monthsApplied);
  result.startDate = refEnd.raw;
  result.deadline = base;
  result.events.push({
    date: refEnd.raw,
    label: 'Fin de la période de référence d’acquisition — point de départ (L3141-19-2).',
  });
  result.events.push({
    date: base,
    label: `Échéance de base = fin de période + ${monthsApplied} mois.`,
  });

  const absence = resolveAbsence(input, reprise);
  result.absenceStatus = absence.ok ? absence.absenceStatus : null;

  if (!absence.ok) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(...absence.messages);
    return result;
  }

  if (absence.inferred) {
    result.warnings.push(
      'Situation d’absence non renseignée : « repris » déduit de la date de reprise.',
    );
  }

  // Toujours absent (confirmé) : le délai court et expire à la base.
  if (absence.absenceStatus === 'ABSENT') {
    result.effectiveExpiresAt = base;
    result.events.push({
      date: null,
      label: 'Salarié toujours absent : le délai court, aucune suspension.',
    });
    result.status = simpleDelayStatus(refEnd.raw ?? '', base, today);
    result.legalBasis = legalBasis('ARRET_LONG', monthsApplied);
    return result;
  }

  // Repris avec date fiable.
  const repriseRaw = reprise.raw ?? '';
  result.events.push({ date: repriseRaw, label: 'Reprise du travail.' });

  if (compareDates(repriseRaw, refEnd.raw ?? '') < 0) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(MSG_REPRISE_BEFORE_REF_END);
    return result;
  }

  // Reprise après l'échéance : expiré, aucune prolongation.
  if (compareDates(repriseRaw, base) > 0) {
    result.effectiveExpiresAt = base;
    result.events.push({
      date: base,
      label: 'Expiration du délai pendant l’absence : aucune prolongation malgré la reprise.',
    });
    result.status = CarryoverDelayStatus.EXPIRE;
    result.legalBasis = legalBasis('ARRET_LONG', monthsApplied);
    return result;
  }

  // Reprise avant (ou le jour de) l'échéance : suspension du reliquat.
  const remainingAtReprise = daysBetween(repriseRaw, base);

  if (info.isNull || info.isInvalid) {
    const suspension: CarryoverSuspensionInfo = {
      from: repriseRaw,
      to: null,
      calendarDays: null,
      remainingDaysAtReprise: remainingAtReprise,
    };
    result.suspension = suspension;
    result.effectiveExpiresAt = null;
    result.events.push({
      date: repriseRaw,
      label: `Reprise avant l’échéance — délai restant suspendu (reliquat ${remainingAtReprise} j).`,
    });
    if (info.isInvalid) {
      result.status = CarryoverDelayStatus.A_VERIFIER;
      result.missingInformation.push(invalidDateMessage('information', info.raw ?? ''));
    } else {
      result.status = CarryoverDelayStatus.SUSPENDU;
      result.events.push({
        date: null,
        label: 'Information non datée : suspension en cours, échéance non calculable.',
      });
      result.missingInformation.push(MSG_INFO_MISSING_SUSPENSION);
    }
    result.legalBasis = legalBasis('ARRET_LONG', monthsApplied);
    return result;
  }

  if (compareDates(info.raw ?? '', repriseRaw) < 0) {
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(MSG_INFO_BEFORE_REPRISE);
    return result;
  }

  const suspendedDays = daysBetween(repriseRaw, info.raw ?? '');
  const effective = addDays(base, suspendedDays);
  const suspension: CarryoverSuspensionInfo = {
    from: repriseRaw,
    to: info.raw,
    calendarDays: suspendedDays,
    remainingDaysAtReprise: remainingAtReprise,
  };
  result.suspension = suspension;
  result.events.push({
    date: repriseRaw,
    label: `Reprise avant l’échéance — reliquat de ${remainingAtReprise} j suspendu.`,
  });

  if (input.informationDateCertain === true) {
    result.effectiveExpiresAt = effective;
    result.events.push({
      date: info.raw,
      label: `Réception des informations (L3141-19-3) — reprise du décompte (${remainingAtReprise} j restants).`,
    });
    result.events.push({
      date: effective,
      label: 'Échéance effective après suspension.',
    });
    if (compareDates(today, refEnd.raw ?? '') < 0) {
      result.status = CarryoverDelayStatus.EN_ATTENTE;
    } else if (compareDates(today, repriseRaw) <= 0) {
      result.status = CarryoverDelayStatus.EN_COURS;
    } else if (compareDates(today, info.raw ?? '') < 0) {
      result.status = CarryoverDelayStatus.SUSPENDU;
    } else if (compareDates(today, effective) <= 0) {
      result.status = CarryoverDelayStatus.EN_COURS;
    } else {
      result.status = CarryoverDelayStatus.EXPIRE;
    }
  } else {
    result.indicativeExpiresAt = effective;
    result.status = CarryoverDelayStatus.A_VERIFIER;
    result.missingInformation.push(
      input.informationDateCertain === false
        ? MSG_INFO_NOT_CERTAIN_FALSE
        : MSG_INFO_NOT_CERTAIN_UNKNOWN,
    );
    result.events.push({
      date: effective,
      label: 'Échéance indicative (réception à date certaine non confirmée).',
    });
  }
  result.legalBasis = legalBasis('ARRET_LONG', monthsApplied);
  return result;
}

/**
 * Calcule l'échéance légale d'un report de congés pour maladie.
 * Fonction pure : aucune entrée/sortie, aucun état partagé, aucune date
 * inventée. Fournir `today` pour un comportement déterministe.
 */
export function computeCarryoverExpiry(
  input: CarryoverExpiryInput,
): CarryoverExpiryResult {
  const result = baseResult(input, LEGAL_CARRYOVER_MONTHS);
  const today = resolveToday(input, result);
  result.monthsApplied = resolveMonths(input, result);
  result.legalBasis = legalBasis(input.regime, result.monthsApplied);

  if (input.regime === 'GENERAL') {
    return computeGeneral(input, today, result);
  }
  return computeArretLong(input, today, result);
}

/** Enveloppe « service » minimale pour une intégration Nest ultérieure. */
export class CarryoverExpiryService {
  compute(input: CarryoverExpiryInput): CarryoverExpiryResult {
    return computeCarryoverExpiry(input);
  }
}
