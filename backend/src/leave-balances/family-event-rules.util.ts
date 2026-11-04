/**
 * JUR-029 / JUR-030 — durées des congés pour événements familiaux, VERSIONNÉES
 * et par régime. Composant PUR (aucune écriture).
 *
 * Valeurs issues des références officielles (vérifiées) :
 *  - Code du travail L3142-1 (mariage, Pacs) ;
 *  - Code du travail L3142-4 (naissance, adoption, décès, annonce handicap,
 *    mariage d'un enfant = 1 jour ouvrable) ;
 *  - Code du travail L3142-1-1 (congé de deuil, 8 jours, fractionnable, 1 an) ;
 *  - Code du travail L1225-61 (enfant malade, 3 ou 5 jours, non rémunéré) ;
 *  - Syntec 5.7 en vigueur depuis le 01/05/2026 (mariage/Pacs 4 jours ouvrés,
 *    mariage d'un enfant 1 jour ouvré, décès par lien familial).
 *
 * Aucune conversion proportionnelle jours ouvrés/ouvrables : les unités réelles
 * sont conservées. Lorsqu'une version historique ne peut être établie de façon
 * fiable, une anomalie demande explicitement la vérification RH (aucun droit
 * approximatif).
 */
import { LegalEntityConventionType } from '../legal-entities/legal-entity.entity';

export type FamilyEventKind =
  | 'MARIAGE_PACS'
  | 'MARIAGE_ENFANT'
  | 'NAISSANCE'
  | 'ADOPTION'
  | 'DECES'
  | 'DECES_ENFANT'
  | 'DEUIL_ENFANT'
  | 'ANNONCE_HANDICAP_ENFANT'
  | 'ENFANT_MALADE';

export type FamilyEventUnit = 'OUVRES' | 'OUVRABLES';
export type FamilyEventSource = 'CODE_TRAVAIL' | 'CONVENTION_COLLECTIVE';

export type FamilyEventStartMode =
  | 'BIRTH_OR_NEXT_WORKING'
  | 'ADOPTION_2026';

export type FamilyLink =
  | 'ENFANT'
  | 'CONJOINT'
  | 'PARENT'
  | 'FRERE_SOEUR'
  | 'BEAU_PARENT'
  | 'AUTRE_ASCENDANT'
  | 'AUTRE';

export type AnnonceNature = 'HANDICAP' | 'PATHOLOGIE_CHRONIQUE' | 'CANCER';

export interface FamilyEventParams {
  lien?: FamilyLink;
  enfantAge?: number;
  aCharge?: boolean;
  nbEnfantsCharge?: number;
  /** Enfant de 25 ans ou plus, lui-même parent (décès d'enfant → 14 jours). */
  enfantEstParent?: boolean;
  /** Personne de moins de 25 ans à charge effective et permanente (→ 14 jours). */
  personneChargeMoins25?: boolean;
  /** Nature de l'annonce (handicap / pathologie chronique / cancer). */
  natureAnnonce?: AnnonceNature;
}

export interface FamilyEventApplicableRule {
  kind: FamilyEventKind;
  label: string;
  days: number;
  unit: FamilyEventUnit;
  source: FamilyEventSource;
  reference: string;
  conditions: string;
  requiredJustificatifs: string[];
  paid: boolean;
  fractionnement: string | null;
  anomalies: string[];
  /** La durée est-elle certaine (true) ou dépend-elle d'une info manquante / d'une décision RH (false) ? */
  daysCertain: boolean;
  /**
   * Fenêtre temporelle stricte autour de l'événement, en jours :
   * `beforeDays` jours avant eventDate et `afterDays` jours après eventDate.
   * Présente uniquement lorsque la version applicable définit une fenêtre
   * (ex. Syntec 2023-2026 : naissance « entourant » la date, adoption
   * « suivant » l'arrivée).
   */
  temporalWindow?: { beforeDays: number; afterDays: number };
  /** Les jours demandés doivent être consécutifs (jours ouvrés). */
  consecutive?: boolean;
  /** Contrainte de début de congé propre à la version applicable. */
  startMode?: FamilyEventStartMode;
}

interface Resolved {
  days: number;
  unit: FamilyEventUnit;
  source: FamilyEventSource;
  reference: string;
  conditions: string;
  requiredJustificatifs: string[];
  paid: boolean;
  fractionnement: string | null;
  anomalies: string[];
  daysCertain: boolean;
  temporalWindow?: { beforeDays: number; afterDays: number };
  consecutive?: boolean;
  startMode?: FamilyEventStartMode;
}

const SYNTEC_2026_DATE = '2026-05-01';
const SYNTEC_2023_DATE = '2023-05-01';

const ANNONCE_REFORM_DATE = '2026-06-14';
const ANNONCE_2023_DATE = '2023-07-21';
const ANNONCE_PATHOLOGIE_DATE = '2021-12-19';
const ANNONCE_HANDICAP_DATE = '2016-08-10';

// Décès d'un enfant (L3142-4) :
//  - avant le 10/08/2016 : 3 jours ouvrables (régime général) ;
//  - 10/08/2016 → 30/06/2020 : 5 jours ouvrables (loi 2016-1088) ;
//  - 01/07/2020 → 20/07/2023 : 5 jours, portés à 7 jours ouvrés
//    (enfant < 25 ans, enfant lui-même parent, personne < 25 ans à charge) ;
//  - depuis le 21/07/2023 : 12 jours ouvrables, portés à 14 (mêmes situations).
const DECES_ENFANT_2023_DATE = '2023-07-21';
const DECES_ENFANT_2020_DATE = '2020-07-01';
const DECES_ENFANT_2016_DATE = '2016-08-10';

function historicalSyntecAnomalies(historical: boolean): string[] {
  if (!historical) return [];
  return [
    'Version Syntec 5.7 antérieure au 01/05/2026 non vérifiée de façon fiable — minimum légal appliqué (vérification RH requise).',
  ];
}

function resolve(
  kind: FamilyEventKind,
  date: string,
  conventionType: LegalEntityConventionType,
  params: FamilyEventParams,
): Resolved {
  const isSyntec = conventionType === LegalEntityConventionType.SYNTEC;
  const syntec2026 = isSyntec && date >= SYNTEC_2026_DATE;
  const syntec2023 =
    isSyntec && date >= SYNTEC_2023_DATE && date < SYNTEC_2026_DATE;
  const syntecKnown = syntec2026 || syntec2023;
  const syntecLegacy = isSyntec && date < SYNTEC_2023_DATE;
  const histAnomalies = syntecLegacy
    ? ['Version Syntec antérieure au 01/05/2023 non établie de façon fiable — minimum légal appliqué (vérification RH requise).']
    : [];
  const syntecVersion = syntec2026
    ? 'depuis le 01/05/2026'
    : 'du 01/05/2023 au 30/04/2026';

  switch (kind) {
    case 'MARIAGE_PACS':
      if (syntecKnown) {
        return {
          days: 4, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: `Syntec 5.7 (${syntecVersion})`,
          conditions: 'Mariage ou conclusion d’un Pacs du salarié.',
          requiredJustificatifs: ['Acte de mariage ou attestation de Pacs'],
          paid: true, fractionnement: null, anomalies: [], daysCertain: true,
        };
      }
      return {
        days: 4, unit: 'OUVRABLES', source: 'CODE_TRAVAIL',
        reference: 'L3142-1',
        conditions: 'Mariage ou conclusion d’un Pacs du salarié.',
        requiredJustificatifs: ['Acte de mariage ou attestation de Pacs'],
        paid: true, fractionnement: null, anomalies: histAnomalies, daysCertain: true,
      };

    case 'MARIAGE_ENFANT':
      if (syntecKnown) {
        return {
          days: 1, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: `Syntec 5.7 (${syntecVersion})`,
          conditions: 'Mariage d’un enfant du salarié : 1 jour ouvré.',
          requiredJustificatifs: ['Acte de mariage de l’enfant et justificatif de filiation'],
          paid: true, fractionnement: null, anomalies: [], daysCertain: true,
        };
      }
      return {
        days: 1, unit: 'OUVRABLES', source: 'CODE_TRAVAIL',
        reference: 'L3142-4',
        conditions: 'Mariage d’un enfant du salarié : 1 jour ouvrable.',
        requiredJustificatifs: ['Acte de mariage de l’enfant et justificatif de filiation'],
        paid: true, fractionnement: null, anomalies: histAnomalies, daysCertain: true,
      };

    case 'NAISSANCE':
      if (syntec2026) {
        return {
          days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: 'Syntec 5.7 (depuis le 01/05/2026)',
          conditions: 'Naissance d’un enfant du salarié : 3 jours ouvrés consécutifs, commençant au choix du salarié le jour de la naissance ou le premier jour ouvré suivant.',
          requiredJustificatifs: ['Acte de naissance'],
          paid: true, fractionnement: null, anomalies: [], daysCertain: true,
          consecutive: true, startMode: 'BIRTH_OR_NEXT_WORKING',
        };
      }
      if (syntec2023) {
        return {
          days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: 'Syntec 5.7 (du 01/05/2023 au 30/04/2026)',
          conditions: 'Naissance d’un enfant du salarié : 3 jours ouvrés, consécutifs ou non, dans une période de quinze jours entourant la date de naissance (aucun découpage fixe 7/7 ; jours manifestement hors d’une fenêtre de quinze jours contenant la naissance refusés).',
          requiredJustificatifs: ['Acte de naissance'],
          paid: true,
          fractionnement: '3 jours ouvrés, consécutifs ou non, dans une période de quinze jours entourant la naissance (cumul plafonné à 3 jours pour le même événement).',
          anomalies: [], daysCertain: true,
          temporalWindow: { beforeDays: 14, afterDays: 14 },
        };
      }
      return {
        days: 3, unit: 'OUVRABLES', source: 'CODE_TRAVAIL',
        reference: 'L3142-4',
        conditions: 'Naissance d’un enfant du salarié : 3 jours ouvrables, à prendre dans la période entourant la naissance.',
        requiredJustificatifs: ['Acte de naissance'],
        paid: true, fractionnement: null, anomalies: histAnomalies, daysCertain: true,
      };

    case 'ADOPTION':
      if (syntec2026) {
        return {
          days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: 'Syntec 5.7 (depuis le 01/05/2026)',
          conditions: 'Arrivée d’un enfant adopté au foyer : 3 jours ouvrés consécutifs, commençant au choix du salarié pendant les sept jours précédant l’arrivée au foyer, le jour de l’arrivée ou le premier jour ouvré suivant.',
          requiredJustificatifs: ['Jugement ou attestation d’adoption'],
          paid: true, fractionnement: null, anomalies: [], daysCertain: true,
          consecutive: true, startMode: 'ADOPTION_2026',
        };
      }
      if (syntec2023) {
        return {
          days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: 'Syntec 5.7 (du 01/05/2023 au 30/04/2026)',
          conditions: 'Arrivée d’un enfant adopté au foyer : 3 jours ouvrés, consécutifs ou non, dans une période de quinze jours suivant l’arrivée au foyer.',
          requiredJustificatifs: ['Jugement ou attestation d’adoption'],
          paid: true,
          fractionnement: '3 jours ouvrés, consécutifs ou non, dans une période de quinze jours suivant l’arrivée au foyer.',
          anomalies: [], daysCertain: true,
          temporalWindow: { beforeDays: 0, afterDays: 14 },
        };
      }
      return {
        days: 3, unit: 'OUVRABLES', source: 'CODE_TRAVAIL',
        reference: 'L3142-4',
        conditions: 'Arrivée d’un enfant adopté au foyer : 3 jours ouvrables.',
        requiredJustificatifs: ['Jugement ou attestation d’adoption'],
        paid: true, fractionnement: null, anomalies: histAnomalies, daysCertain: true,
      };

    case 'DECES': {
      const labels: Record<FamilyLink, string> = {
        ENFANT: 'enfant',
        CONJOINT: 'conjoint/partenaire/concubin',
        PARENT: 'père/mère',
        FRERE_SOEUR: 'frère/sœur',
        BEAU_PARENT: 'beau-père/belle-mère',
        AUTRE_ASCENDANT: 'autre ascendant (grand-parent)',
        AUTRE: 'autre proche',
      };
      const lien = (params.lien ?? 'AUTRE') as FamilyLink;
      const anomalies: string[] = [];

      if (lien === 'ENFANT') {
        anomalies.push(
          'Pour le décès d’un enfant, utiliser le type « Décès d’un enfant » (12 ou 14 jours).',
        );
      }

      if (syntecKnown) {
        switch (lien) {
          case 'CONJOINT':
            return {
              days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
              reference: `Syntec 5.7 (${syntecVersion})`,
              conditions: 'Décès du conjoint, du partenaire de Pacs ou du concubin : 3 jours ouvrés.',
              requiredJustificatifs: ['Acte de décès et justificatif du lien'],
              paid: true, fractionnement: null, anomalies, daysCertain: true,
            };
          case 'PARENT':
            return {
              days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
              reference: `Syntec 5.7 (${syntecVersion})`,
              conditions: 'Décès du père ou de la mère : 3 jours ouvrés.',
              requiredJustificatifs: ['Acte de décès et justificatif du lien'],
              paid: true, fractionnement: null, anomalies, daysCertain: true,
            };
          case 'FRERE_SOEUR':
            return {
              days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
              reference: `Syntec 5.7 (${syntecVersion})`,
              conditions: 'Décès d’un frère ou d’une sœur : 3 jours ouvrés.',
              requiredJustificatifs: ['Acte de décès et justificatif du lien'],
              paid: true, fractionnement: null, anomalies, daysCertain: true,
            };
          case 'BEAU_PARENT':
            return {
              days: 3, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
              reference: `Syntec 5.7 (${syntecVersion})`,
              conditions: 'Décès du beau-père ou de la belle-mère au sens conventionnel : 3 jours ouvrés.',
              requiredJustificatifs: ['Acte de décès et justificatif du lien'],
              paid: true, fractionnement: null, anomalies, daysCertain: true,
            };
          case 'AUTRE_ASCENDANT':
            return {
              days: 2, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
              reference: `Syntec 5.7 (${syntecVersion})`,
              conditions: 'Décès d’un autre ascendant (grand-parent) : 2 jours ouvrés.',
              requiredJustificatifs: ['Acte de décès et justificatif du lien'],
              paid: true, fractionnement: null, anomalies, daysCertain: true,
            };
          case 'ENFANT':
            anomalies.push(
              'Le décès d’un enfant est traité par le type « Décès d’un enfant » (12 ou 14 jours ouvrés).',
            );
            return {
              days: 12, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
              reference: `Syntec 5.7 (${syntecVersion})`,
              conditions: 'Décès d’un enfant (voir type dédié).',
              requiredJustificatifs: ['Acte de décès de l’enfant et justificatif d’âge / de charge'],
              paid: true, fractionnement: null, anomalies, daysCertain: false,
            };
          default:
            anomalies.push(
              'Lien familial non couvert par l’article 5.7 Syntec — vérification RH requise.',
            );
            return {
              days: 0, unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
              reference: `Syntec 5.7 (${syntecVersion})`,
              conditions: `Décès du ${labels[lien]} : non couvert par la convention.`,
              requiredJustificatifs: ['Acte de décès et justificatif du lien de parenté'],
              paid: true, fractionnement: null, anomalies, daysCertain: false,
            };
        }
      }

      // Régime légal (L3142-4) : conjoint/partenaire/concubin, père/mère,
      // beau-père/belle-mère, frère/sœur = 3 jours ouvrables.
      const legalCovered =
        lien === 'CONJOINT' ||
        lien === 'PARENT' ||
        lien === 'FRERE_SOEUR' ||
        lien === 'BEAU_PARENT';

      if (lien === 'AUTRE_ASCENDANT') {
        anomalies.push(
          'Autre ascendant non couvert par l’article L3142-4 — vérification RH requise (Syntec 5.7 ou accord d’entreprise éventuel).',
        );
      }
      if (lien === 'AUTRE') {
        anomalies.push(
          'Lien familial non couvert par l’article L3142-4 — vérification RH requise.',
        );
      }
      anomalies.push(...histAnomalies);

      return {
        days: legalCovered ? 3 : 0,
        unit: 'OUVRABLES',
        source: 'CODE_TRAVAIL',
        reference: 'L3142-4',
        conditions: `Décès du ${labels[lien]} : ${legalCovered ? '3 jours ouvrables' : 'non couvert par le Code du travail'}.`,
        requiredJustificatifs: ['Acte de décès et justificatif du lien de parenté'],
        paid: true, fractionnement: null, anomalies, daysCertain: legalCovered && !syntecLegacy,
      };
    }

    case 'DECES_ENFANT': {
      const age = params.enfantAge;
      const anomalies: string[] = [];
      const infoCertain =
        age !== undefined ||
        params.enfantEstParent === true ||
        params.personneChargeMoins25 === true;
      if (!infoCertain) {
        anomalies.push('Informations (âge de l’enfant, enfant parent, personne à charge) manquantes — vérification RH requise.');
      }
      const quatorze =
        (age !== undefined && age < 25) ||
        params.enfantEstParent === true ||
        params.personneChargeMoins25 === true;

      // Syntec 2026 : 12/14 jours ouvrés.
      if (syntec2026) {
        const days = quatorze ? 14 : 12;
        return {
          days,
          unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: 'Syntec 5.7 (depuis le 01/05/2026)',
          conditions: 'Décès d’un enfant du salarié : 12 jours ; 14 jours si enfant de moins de 25 ans, enfant de 25 ans ou plus lui-même parent, ou personne de moins de 25 ans à charge effective et permanente.',
          requiredJustificatifs: ['Acte de décès de l’enfant et justificatif d’âge / de charge'],
          paid: true, fractionnement: null, anomalies, daysCertain: infoCertain,
        };
      }

      // Syntec 2023-2026 : 5/7 jours ouvrés, confrontés au minimum légal.
      if (syntec2023) {
        if (date >= DECES_ENFANT_2023_DATE) {
          // Depuis le 21/07/2023, le minimum légal (12/14 jours ouvrables)
          // est plus favorable que la convention historique (5/7 ouvrés).
          const days = quatorze ? 14 : 12;
          anomalies.push(
            'Syntec 5.7 historique (5/7 jours ouvrés) inférieure au minimum légal applicable — minimum légal appliqué.',
          );
          return {
            days,
            unit: 'OUVRABLES', source: 'CODE_TRAVAIL',
            reference: 'L3142-4 (depuis le 21/07/2023)',
            conditions: 'Décès d’un enfant du salarié : minimum légal de 12 ou 14 jours ouvrables.',
            requiredJustificatifs: ['Acte de décès de l’enfant et justificatif d’âge / de charge'],
            paid: true, fractionnement: null, anomalies, daysCertain: infoCertain,
          };
        }

        // 01/05/2023 → 20/07/2023 : Syntec 5 jours, portés à 7 jours ouvrés
        // (enfant < 25 ans, enfant lui-même parent, personne < 25 ans à charge).
        const days = quatorze ? 7 : 5;
        return {
          days,
          unit: 'OUVRES', source: 'CONVENTION_COLLECTIVE',
          reference: 'Syntec 5.7 (du 01/05/2023 au 30/04/2026)',
          conditions: 'Décès d’un enfant du salarié : 5 jours, portés à 7 jours ouvrés si enfant de moins de 25 ans, enfant lui-même parent, ou personne de moins de 25 ans à charge effective et permanente.',
          requiredJustificatifs: ['Acte de décès de l’enfant et justificatif d’âge / de charge'],
          paid: true, fractionnement: null, anomalies, daysCertain: infoCertain,
        };
      }

      // Régime légal (L3142-4), versionné.
      if (date >= DECES_ENFANT_2023_DATE) {
        const days = quatorze ? 14 : 12;
        anomalies.push(...histAnomalies);
        return {
          days,
          unit: 'OUVRABLES',
          source: 'CODE_TRAVAIL',
          reference: 'L3142-4 (depuis le 21/07/2023)',
          conditions: 'Décès d’un enfant du salarié : 12 jours ouvrables ; 14 jours si enfant de moins de 25 ans, enfant de 25 ans ou plus lui-même parent, ou personne de moins de 25 ans à charge effective et permanente.',
          requiredJustificatifs: ['Acte de décès de l’enfant et justificatif d’âge / de charge'],
          paid: true, fractionnement: null, anomalies,
          daysCertain: !syntecLegacy && infoCertain,
        };
      }

      if (date >= DECES_ENFANT_2020_DATE) {
        // 01/07/2020 → 20/07/2023 : 5 jours, portés à 7 jours ouvrés.
        const days = quatorze ? 7 : 5;
        anomalies.push(...histAnomalies);
        return {
          days,
          unit: quatorze ? 'OUVRES' : 'OUVRABLES',
          source: 'CODE_TRAVAIL',
          reference: 'L3142-4 (du 01/07/2020 au 20/07/2023)',
          conditions: 'Décès d’un enfant du salarié : 5 jours, portés à 7 jours ouvrés si enfant de moins de 25 ans, enfant lui-même parent, ou personne de moins de 25 ans à charge effective et permanente.',
          requiredJustificatifs: ['Acte de décès de l’enfant et justificatif d’âge / de charge'],
          paid: true, fractionnement: null, anomalies,
          daysCertain: !syntecLegacy && infoCertain,
        };
      }

      // 10/08/2016 → 30/06/2020 : 5 jours ouvrables (loi 2016-1088).
      if (date >= DECES_ENFANT_2016_DATE) {
        anomalies.push(...histAnomalies);
        return {
          days: 5,
          unit: 'OUVRABLES',
          source: 'CODE_TRAVAIL',
          reference: 'L3142-4 (du 10/08/2016 au 30/06/2020)',
          conditions: 'Décès d’un enfant du salarié : 5 jours ouvrables.',
          requiredJustificatifs: ['Acte de décès de l’enfant'],
          paid: true, fractionnement: null, anomalies,
          daysCertain: !syntecLegacy,
        };
      }

      // Avant le 10/08/2016 : régime général de 3 jours ouvrables.
      anomalies.push(...histAnomalies);
      return {
        days: 3,
        unit: 'OUVRABLES',
        source: 'CODE_TRAVAIL',
        reference: 'L3142-4 (antérieure au 10/08/2016)',
        conditions: 'Décès d’un enfant du salarié : 3 jours ouvrables (régime général antérieur au 10/08/2016).',
        requiredJustificatifs: ['Acte de décès de l’enfant'],
        paid: true, fractionnement: null, anomalies,
        daysCertain: !syntecLegacy,
      };
    }

    case 'DEUIL_ENFANT':
      return {
        days: 8, unit: 'OUVRABLES', source: 'CODE_TRAVAIL',
        reference: 'L3142-1-1',
        conditions: 'Congé de deuil distinct en cas de décès d’un enfant de moins de 25 ans (ou d’une personne de moins de 25 ans à charge). À prendre dans un délai d’un an à compter du décès. Fractionnement en deux périodes au maximum, chacune d’au moins une journée. Pour Syntec, information de l’employeur au moins 24 heures avant chaque période.',
        requiredJustificatifs: ['Acte de décès de l’enfant'],
        paid: true,
        fractionnement: 'Deux périodes au maximum, chacune d’au moins une journée ; délai d’un an à compter du décès ; (Syntec) information de l’employeur 24 h avant chaque période.',
        anomalies: [],
        daysCertain: true,
      };

    case 'ANNONCE_HANDICAP_ENFANT': {
      const nature = params.natureAnnonce;
      const natureMissing = nature === undefined;
      const anomalies: string[] = [];
      if (natureMissing) {
        anomalies.push(
          'Nature de l’annonce non renseignée — information à vérifier par la RH (aucune attribution automatique au handicap).',
        );
      }
      let days: number;
      let reference: string;
      let daysCertain = true;

      if (date >= ANNONCE_REFORM_DATE) {
        days = 10;
        reference = 'L3142-4 (mod. en vigueur depuis le 14/06/2026)';
      } else if (date >= ANNONCE_2023_DATE) {
        days = 5;
        reference = 'L3142-4 (version en vigueur entre le 21/07/2023 et le 13/06/2026)';
      } else if (date >= ANNONCE_PATHOLOGIE_DATE) {
        days = 2;
        reference = 'L3142-4 (version en vigueur entre le 19/12/2021 et le 20/07/2023)';
      } else if (date >= ANNONCE_HANDICAP_DATE) {
        if (nature === 'HANDICAP') {
          days = 2;
          reference = 'L3142-4 (version en vigueur entre le 10/08/2016 et le 18/12/2021) — handicap uniquement.';
        } else if (
          nature === 'PATHOLOGIE_CHRONIQUE' ||
          nature === 'CANCER'
        ) {
          days = 0;
          daysCertain = false;
          reference = 'L3142-4 (version antérieure au 19/12/2021)';
          anomalies.push(
            'Annonce d’une pathologie chronique ou d’un cancer non couverte avant le 19/12/2021 — vérification RH requise.',
          );
        } else {
          // Nature manquante : le droit dépend de la nature réelle. Ne pas
          // supposer HANDICAP ; 2 jours seulement si handicap, sinon non couvert.
          days = 2;
          daysCertain = false;
          reference = 'L3142-4 (version en vigueur entre le 10/08/2016 et le 18/12/2021)';
          anomalies.push(
            'Nature de l’annonce non renseignée : 2 jours uniquement si handicap, sinon non couvert avant le 19/12/2021 — vérification RH requise.',
          );
        }
      } else {
        days = 0;
        daysCertain = false;
        reference = 'L3142-4 (antérieure au 10/08/2016)';
        anomalies.push(
          'Congé pour annonce d’un handicap non applicable avant le 10/08/2016 — vérification RH requise.',
        );
      }

      // Une nature manquante rend la déclaration incertaine même lorsque la
      // durée ne dépend pas de la nature : information à vérifier, sans
      // attribution automatique.
      if (natureMissing) {
        daysCertain = false;
      }

      return {
        days,
        unit: 'OUVRABLES',
        source: 'CODE_TRAVAIL',
        reference,
        conditions: 'Annonce de la survenue d’un handicap, d’une pathologie chronique concernée ou d’un cancer chez un enfant.',
        requiredJustificatifs: ['Certificat médical'],
        paid: true, fractionnement: null,
        anomalies,
        daysCertain,
      };
    }

    case 'ENFANT_MALADE': {
      const age = params.enfantAge;
      const nb = params.nbEnfantsCharge;
      const anomalies: string[] = [];
      const fiveDays = (age !== undefined && age < 1) || (nb !== undefined && nb >= 3);
      if (age === undefined && nb === undefined) {
        anomalies.push('Âge de l’enfant et nombre d’enfants à charge manquants — 3 ou 5 jours à déterminer par la RH.');
      }
      return {
        days: fiveDays ? 5 : 3,
        unit: 'OUVRABLES',
        source: 'CODE_TRAVAIL',
        reference: 'L1225-61',
        conditions: 'Enfant malade : 3 jours par an (enfant de moins de 16 ans) ; 5 jours si enfant de moins d’un an ou au moins 3 enfants à charge.',
        requiredJustificatifs: ['Certificat médical'],
        paid: false,
        fractionnement: null,
        anomalies,
        daysCertain: age !== undefined && nb !== undefined,
      };
    }

    default:
      throw new Error(`Événement familial inconnu : ${kind}`);
  }
}

export function applicableFamilyEventRule(
  kind: FamilyEventKind,
  date: string,
  conventionType: LegalEntityConventionType,
  params: FamilyEventParams = {},
): FamilyEventApplicableRule {
  const r = resolve(kind, date, conventionType, params);
  return { kind, label: labelFor(kind), ...r };
}

function labelFor(kind: FamilyEventKind): string {
  switch (kind) {
    case 'MARIAGE_PACS': return 'Mariage / Pacs';
    case 'MARIAGE_ENFANT': return 'Mariage d’un enfant';
    case 'NAISSANCE': return 'Naissance';
    case 'ADOPTION': return 'Adoption';
    case 'DECES': return 'Décès (proche)';
    case 'DECES_ENFANT': return 'Décès d’un enfant';
    case 'DEUIL_ENFANT': return 'Congé de deuil (décès d’un enfant)';
    case 'ANNONCE_HANDICAP_ENFANT': return 'Annonce d’un handicap / pathologie chronique / cancer chez un enfant';
    case 'ENFANT_MALADE': return 'Enfant malade';
  }
}

export const FAMILY_EVENT_KINDS: FamilyEventKind[] = [
  'MARIAGE_PACS',
  'MARIAGE_ENFANT',
  'NAISSANCE',
  'ADOPTION',
  'DECES',
  'DECES_ENFANT',
  'DEUIL_ENFANT',
  'ANNONCE_HANDICAP_ENFANT',
  'ENFANT_MALADE',
];
