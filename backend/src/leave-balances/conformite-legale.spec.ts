/**
 * Tests de conformité — Code du travail, convention Syntec (IDCC 1486) et
 * règles internes GMES.
 *
 * IMPORTANT : ce fichier ne modifie AUCUNE règle métier. Il vérifie le
 * comportement RÉEL de l'application et documente les écarts.
 *
 * Légende des statuts :
 *  - CONFORME ................... test actif qui passe sur le comportement réel.
 *  - NON GÉRÉ PAR L'APPLICATION .. scénario `it.skip` décrivant une fonctionnalité
 *                                absente (à implémenter) — pas un faux succès.
 *  - À CONFIRMER AVEC RH ........ point juridique dépendant d'un accord/choix RH.
 *
 * Sources officielles VÉRIFIÉES (pages Légifrance / Service-Public lues le
 * 16/10/2026 — titres et textes extraits ; LEGIARTI000033020801 = L3141-7,
 * LEGIARTI000033020705 = L3141-23, KALIARTI000044253082 = Syntec 5.1) :
 *  - L3141-3 : droit à 2,5 jours ouvrables/mois de travail effectif, 30 jours
 *    ouvrables maximum.
 *  - L3141-7 : « Lorsque le nombre de jours ouvrables calculé conformément aux
 *    articles L3141-3 et L3141-6 n'est pas un nombre entier, la durée du congé
 *    est portée au nombre entier immédiatement supérieur. » (arrondi à l'entier
 *    SUPÉRIEUR).
 *  - L3141-23 (fractionnement, régime supplétif, jours OUVRABLES) : fraction
 *    continue d'au moins 12 jours ouvrables pendant le 1er mai → 31 octobre ;
 *    hors période : ≥ 6 jours ouvrables → +2 jours ouvrables, 3 à 5 jours →
 *    +1 jour ouvrable ; jours au-delà de 24 jours ouvrables (5e semaine)
 *    exclus ; dérogation possible après accord individuel du salarié.
 *  - L3141-19-1 et suivants : report des congés non pris en raison d'un arrêt
 *    maladie / AT-MP.
 *  - L3141-5 (mod. loi n°2024-364 du 22/04/2024, en vigueur depuis le
 *    24/04/2024) : l'arrêt AT/MP est assimilé à du travail effectif SANS la
 *    limite d'un an (limite supprimée par la loi) ; la maladie non
 *    professionnelle est assimilée dans les conditions de L3141-5-1.
 *  - L3141-5-1 : maladie non professionnelle → 2 jours ouvrables/mois, plafond
 *    24 jours ouvrables.
 *  - Service-Public.fr F37482 (vérifié) : confirme la suppression de la limite
 *    d'un an pour AT/MP, 2 jours ouvrables/mois (24 j/an) pour la maladie non
 *    professionnelle, et le report de 15 mois.
 *  - Syntec 5.1 (vérifié) : 25 jours ouvrés = 30 jours ouvrables ; ancienneté
 *    5/10/15/20 ans → 1/2/3/4 jours ouvrés supplémentaires, appréciée à
 *    l'ouverture de la période de prise (1er mai à défaut) ; fractionnement en
 *    jours OUVRÉS : 3-4 jours hors période → +1 jour ouvré, ≥ 5 jours →
 *    +2 jours ouvrés, 5e semaine exclue.
 *  - Syntec 5.3 (version EN VIGUEUR, vérifiée) : acquisition du 1er juin au
 *    31 mai ; la période de prise démarre, sauf stipulation différente, le
 *    1er mai ; période de prise de 13 mois maximum ; report au-delà sur demande
 *    écrite de l'employeur.
 *  - Syntec 5.5 (vérifié) : périodes assimilées à du travail effectif (congés,
 *    maternité/paternité/adoption, repos compensateurs, événements familiaux
 *    5.7, service national…) — le texte conventionnel mentionne encore « 1 an »
 *    pour AT/MP, mais la loi (L3141-5) ayant supprimé cette limite, le plancher
 *    légal sans limite prévaut.
 *  - Syntec 5.7 : événements familiaux (durées à vérifier sur Légifrance).
 *  - Règles internes GMES : prévenance 30/60 jours, période estivale 01/05 →
 *    31/10, seuil 21 jours, décompte du samedi.
 */
import { describe, expect, it } from '@jest/globals';

import { DayPeriod } from '../leave-requests/leave-request.entity';
import { calculateDeductedLeaveDays } from '../leave-requests/leave-request-period.util';
import { evaluateSubmissionNotice } from '../leave-requests/leave-request-notice.util';
import { allocatePaidLeave } from './leave-allocation.util';
import { roundPeriodCloseDays } from './reference-period-rounding.util';
import {
  counterReferencePeriod,
  currentReferencePeriod,
  referencePeriodEndDate,
  referencePeriodStartDate,
} from './reference-period.util';

describe('CONFORMITÉ A — acquisition et décompte des congés payés', () => {
  describe('décompte en jours ouvrables (Code du travail L3141-3, Syntec 5.1)', () => {
    it('semaine complète du lundi au vendredi après-midi : 5 jours + samedi GMES = 6', () => {
      // 05/01/2026 = lundi, 09/01/2026 = vendredi.
      const days = calculateDeductedLeaveDays(
        new Date('2026-01-05T00:00:00Z'),
        new Date('2026-01-09T00:00:00Z'),
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      // lundi→vendredi = 5 jours ouvrables, + samedi 10/01 (règle GMES).
      expect(days).toBe(6);
    });

    it('semaine terminée le vendredi MATIN : 4,5 jours (pas de samedi)', () => {
      const days = calculateDeductedLeaveDays(
        new Date('2026-01-05T00:00:00Z'),
        new Date('2026-01-09T00:00:00Z'),
        DayPeriod.MATIN,
        DayPeriod.MATIN,
        new Set(),
      );
      expect(days).toBe(4.5);
    });

    it('le dimanche seul n’est jamais décompté', () => {
      // 04/01/2026 = dimanche.
      const days = calculateDeductedLeaveDays(
        new Date('2026-01-04T00:00:00Z'),
        new Date('2026-01-04T00:00:00Z'),
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      expect(days).toBe(0);
    });

    it('un jour férié (non décomptable) au milieu du congé est exclu', () => {
      // 02/11/2026 = lundi (déclaré non décomptable), 03/11/2026 = mardi.
      const days = calculateDeductedLeaveDays(
        new Date('2026-11-02T00:00:00Z'),
        new Date('2026-11-03T00:00:00Z'),
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(['2026-11-02']),
      );
      expect(days).toBe(1);
    });

    it('année bissextile : le 29/02/2028 est décompté exactement une fois', () => {
      // 28/02/2028 = lundi, 29/02/2028 = mardi.
      const days = calculateDeductedLeaveDays(
        new Date('2028-02-28T00:00:00Z'),
        new Date('2028-02-29T00:00:00Z'),
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      expect(days).toBe(2);
    });

    it('début en demi-journée (après-midi) : 0,5 + jour suivant complet', () => {
      const days = calculateDeductedLeaveDays(
        new Date('2026-01-05T00:00:00Z'),
        new Date('2026-01-06T00:00:00Z'),
        DayPeriod.APRES_MIDI,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      expect(days).toBe(1.5);
    });

    it('fin en demi-journée (matin) : 1 + 0,5', () => {
      const days = calculateDeductedLeaveDays(
        new Date('2026-01-05T00:00:00Z'),
        new Date('2026-01-06T00:00:00Z'),
        DayPeriod.MATIN,
        DayPeriod.MATIN,
        new Set(),
      );
      expect(days).toBe(1.5);
    });

    it('chevauchement 31/05 → 01/06 : dimanche exclu, lundi décompté', () => {
      // 31/05/2026 = dimanche, 01/06/2026 = lundi.
      const days = calculateDeductedLeaveDays(
        new Date('2026-05-31T00:00:00Z'),
        new Date('2026-06-01T00:00:00Z'),
        DayPeriod.MATIN,
        DayPeriod.APRES_MIDI,
        new Set(),
      );
      expect(days).toBe(1);
    });
  });

  describe('période de référence GMES 01/06 → 31/05 (Code du travail L3141-5, config GMES)', () => {
    it('le 31/05 appartient encore à la période N, le 01/06 à N+1', () => {
      expect(currentReferencePeriod('2026-05-31', '06-01')).toBe('2025-2026');
      expect(currentReferencePeriod('2026-06-01', '06-01')).toBe('2026-2027');
    });

    it('bornes de la période 2026-2027 : 01/06/2026 → 31/05/2027', () => {
      expect(referencePeriodStartDate('2026-2027', '06-01')).toBe('2026-06-01');
      expect(referencePeriodEndDate('2026-2027', '06-01')).toBe('2027-05-31');
    });

    it('année bissextile : 2027-2028 se termine le 31/05/2028 (29/02 inclus)', () => {
      expect(referencePeriodEndDate('2027-2028', '06-01')).toBe('2028-05-31');
    });

    it('compteurs N-1 / N / N+1 associés à la période N 2026-2027', () => {
      expect(counterReferencePeriod('2026-2027', 'N-1')).toBe('2025-2026');
      expect(counterReferencePeriod('2026-2027', 'N')).toBe('2026-2027');
      expect(counterReferencePeriod('2026-2027', 'N+1')).toBe('2027-2028');
    });
  });

  describe('imputation N-1 puis N (congés acquis vs anticipés)', () => {
    it('consomme d’abord N-1 puis N, et laisse N anticipé négatif si nécessaire', () => {
      const result = allocatePaidLeave(
        12,
        [{ id: 1, referencePeriod: '2025-2026', availableDays: 8 }],
        { id: 2, referencePeriod: '2026-2027', availableDays: 0 },
      );
      expect(result.allocations).toEqual([
        { leaveBalanceId: 1, referencePeriod: '2025-2026', days: 8 },
        { leaveBalanceId: 2, referencePeriod: '2026-2027', days: 4 },
      ]);
      expect(result.nBalanceAfter).toBe(-4);
    });
  });
});

describe('CONFORMITÉ A — arrondis des congés payés (Code du travail L3141-7)', () => {
  it('transfert N→N-1 : roundPeriodCloseDays arrondit le SOLDE RESTANT au plus proche', () => {
    // Documente le comportement RÉEL de l'application. IMPORTANT : cet arrondi
    // porte sur availableDays (solde disponible après consommation), PAS sur le
    // droit acquis (acquiredDays). Ce n'est donc pas l'arrondi visé par L3141-7.
    expect(roundPeriodCloseDays(14.33)).toBe(14);
    expect(roundPeriodCloseDays(14.49)).toBe(14);
    expect(roundPeriodCloseDays(14.5)).toBe(15);
    expect(roundPeriodCloseDays(14.99)).toBe(15);
    expect(roundPeriodCloseDays(0.49)).toBe(0);
  });
});

// L3141-7 arrondit le DROIT ACQUIS (calculé selon L3141-3/L3141-6) à l'entier
// supérieur. Dans l'application, acquiredDays est cumulé en précision 0,01 et
// n'est jamais arrondi à l'entier (aucun Math.ceil à la clôture).
// Scénario précis d'embauche en cours d'année :
//   - embauche le 16/07/2026, période 2026-2027 (01/06→31/05).
//   - juillet 2026 : 2,5 × 16/31 = 1,29 j ; août 2026 → mai 2027 : 10 × 2,5 = 25 j.
//   - total acquis = 26,29 jours ouvrables.
//   - L3141-7 : « portée au nombre entier immédiatement supérieur » → 27.
//   - résultat obtenu : 26,29 (≈ 26,5 décomptables) ; résultat légal attendu : 27.
describe.skip('À VÉRIFIER — L3141-7 appliqué aux droits acquis (embauche en cours d’année)', () => {
  it('embauche le 16/07/2026 : acquiredDays = 26,29 j ouvrables ; L3141-7 attend 27 (entier supérieur)', () => {});
  it('le droit acquis (acquiredDays) n’est arrondi à l’entier supérieur à aucun moment (clôture comprise)', () => {});
});

describe('CONFORMITÉ G — prévenance et période de congés (règles internes GMES)', () => {
  const rules = {
    normalDeadlineDays: 30,
    specialDeadlineDays: 60,
    specialDurationThresholdDays: 21,
    summerPeriodStart: '05-01',
    summerPeriodEnd: '10-31',
  };
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('seuil congé long : 21 jours calendaires → 60 jours, 20 jours → 30 jours', () => {
    expect(
      evaluateSubmissionNotice('2026-03-01', '2026-03-21', 21, now, rules)
        .requiredNoticeDays,
    ).toBe(60);
    expect(
      evaluateSubmissionNotice('2026-03-01', '2026-03-20', 20, now, rules)
        .requiredNoticeDays,
    ).toBe(30);
  });

  it('frontière du 1er mai : fin au 30/04 hors période estivale, début au 01/05 en période estivale', () => {
    const before = evaluateSubmissionNotice(
      '2026-04-28',
      '2026-04-30',
      3,
      now,
      rules,
    );
    expect(before.overlapsSummerPeriod).toBe(false);
    expect(before.requiredNoticeDays).toBe(30);

    const after = evaluateSubmissionNotice(
      '2026-05-01',
      '2026-05-01',
      1,
      now,
      rules,
    );
    expect(after.overlapsSummerPeriod).toBe(true);
    expect(after.requiredNoticeDays).toBe(60);
  });

  it('frontière du 31 octobre : fin le 31/10 en période estivale, début le 01/11 hors période', () => {
    expect(
      evaluateSubmissionNotice('2026-10-27', '2026-10-31', 5, now, rules)
        .overlapsSummerPeriod,
    ).toBe(true);
    expect(
      evaluateSubmissionNotice('2026-11-01', '2026-11-05', 5, now, rules)
        .overlapsSummerPeriod,
    ).toBe(false);
  });

  it('ces délais sont des règles internes GMES, pas des délais imposés par la loi', () => {
    // Le Code du travail n'impose pas de délai de prévenance fixe de 30/60 jours
    // au salarié : ces seuils proviennent de la configuration GMES (règles
    // internes), et non d'une disposition légale ou conventionnelle.
    expect(rules.normalDeadlineDays).toBe(30);
    expect(rules.specialDeadlineDays).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Fonctionnalités NON GÉRÉES PAR L'APPLICATION : scénarios à implémenter.
// Ces blocs sont volontairement désactivés (it.skip) : ils ne fabriquent pas de
// faux succès et restent traçables pour un développement ultérieur.
// ---------------------------------------------------------------------------

describe.skip('CONFORMITÉ B — congés d’ancienneté Syntec 5.1 (NON GÉRÉ)', () => {
  it('5 ans d’ancienneté : +1 jour ouvré supplémentaire', () => {});
  it('10 ans : +2 jours ouvrés supplémentaires', () => {});
  it('15 ans : +3 jours ouvrés supplémentaires', () => {});
  it('20 ans : +4 jours ouvrés supplémentaires', () => {});
  it('ancienneté appréciée à l’ouverture de la période de prise (1er mai à défaut de stipulation)', () => {});
  it('durées exprimées en jours ouvrés (lun→ven, non fériés et non chômés)', () => {});
});

describe.skip('CONFORMITÉ C — fractionnement (NON GÉRÉ) : Syntec 5.1 vs régime légal supplétif', () => {
  it('Syntec 5.1 : 3 ou 4 jours OUVRÉS pris hors période → +1 jour ouvré', () => {});
  it('Syntec 5.1 : au moins 5 jours OUVRÉS pris hors période → +2 jours ouvrés', () => {});
  it('Syntec 5.1 : la cinquième semaine est exclue', () => {});
  it('L3141-23 (supplétif) : 3 à 5 jours OUVRABLES hors période → +1 jour ouvrable', () => {});
  it('L3141-23 (supplétif) : au moins 6 jours OUVRABLES hors période → +2 jours ouvrables', () => {});
  it('L3141-23 : jours au-delà de 24 jours ouvrables (5e semaine) exclus', () => {});
  it('L3141-23 : dérogation possible après accord individuel du salarié', () => {});
  it('accord d’entreprise éventuel (à confirmer avec RH)', () => {});
});

describe.skip('CONFORMITÉ D — acquisition pendant les absences (NON GÉRÉ)', () => {
  it('maladie non professionnelle : 2 jours ouvrables/mois, plafond 24 jours (L3141-5-1)', () => {});
  it('AT/MP : acquisition SANS limite de durée depuis le 24/04/2024 (L3141-5, loi 2024-364 — ancienne limite d’un an supprimée)', () => {});
  it('Syntec 5.5 : périodes assimilées (congés, maternité/paternité/adoption, repos compensateurs, événements 5.7…) — le plancher légal sans limite pour AT/MP prévaut', () => {});
  it('report des congés non pris pour maladie/AT-MP (L3141-19-1 et suivants)', () => {});
  it('distinction logiciel (compteurs) vs paie (rémunération) — à confirmer avec RH', () => {});
});

describe.skip('CONFORMITÉ E — période de prise des congés (NON GÉRÉ)', () => {
  it('Syntec 5.3 (en vigueur) : acquisition du 1er juin au 31 mai (déjà gérée par REFERENCE_PERIOD_START)', () => {});
  it('Syntec 5.3 (en vigueur) : la prise démarre, sauf stipulation différente, le 1er mai ; période de 13 mois maximum', () => {});
  it('Syntec 5.3 : report au-delà de 13 mois sur demande écrite de l’employeur', () => {});
  it('ne pas supprimer automatiquement des droits encore légalement reportables (L3141-19-1 et suivants, arrêt maladie/AT-MP)', () => {});
});

describe.skip('CONFORMITÉ F — événements familiaux (Syntec 5.7, NON GÉRÉ)', () => {
  it('mariage / Pacs', () => {});
  it('mariage d’un enfant', () => {});
  it('naissance', () => {});
  it('adoption', () => {});
  it('décès d’un membre de la famille', () => {});
  it('maladie d’un enfant', () => {});
  it('annonce d’un handicap ou d’une pathologie grave concernant un enfant', () => {});
  it('congé de deuil', () => {});
});

describe.skip('CONFORMITÉ H — parentalité (NON GÉRÉ — déclaratif uniquement)', () => {
  it('congé maternité', () => {});
  it('congé paternité et accueil de l’enfant', () => {});
  it('congé adoption', () => {});
  it('autorisations d’absence pour examens médicaux', () => {});
  it('congé supplémentaire de naissance (juillet 2026)', () => {});
});
