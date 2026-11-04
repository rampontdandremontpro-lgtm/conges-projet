# -*- coding: utf-8 -*-
"""Mise à jour du cahier de recette -> v2.0.
Ajout du module 20 « Conformité juridique — Droit français et convention
collective Syntec » (36 scénarios JUR) sans altérer les 420 scénarios
historiques. L'original v1.9 reste intact : on travaille sur une copie.
"""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.0.docx'

VERSION = '2.0'
DATE = '20/10/2026'
AUTEUR = "Daphné RAMPONT-D'ANDREMONT"

W = 'w'
def _el(tag):
    return OxmlElement(W + ':' + tag)

# ---------------------------------------------------------------------------
# Données du module 20
# ---------------------------------------------------------------------------

MODULE_TITLE = '20. Conformité juridique — Droit français et convention collective Syntec'
MODULE_DESC = (
    "Vérifier la conformité de l'application aux dispositions du Code du travail "
    "en vigueur, à la convention collective Syntec (IDCC 1486) sous réserve de son "
    "applicabilité à chaque entreprise de rattachement (GMES, Efficience, GMES "
    "Ingénierie), et aux règles internes GMES. Les références juridiques citées ont "
    "été vérifiées sur Légifrance et Service-Public le 16/10/2026."
)

CORRESPONDANCE = [
    ('L3141-3', 'Droit à 2,5 jours ouvrables par mois de travail effectif ; plafond de 30 jours ouvrables.'),
    ('L3141-7', 'Droit acquis fractionnaire porté à l’entier immédiatement supérieur (arrondi légal).'),
    ('L3141-23', 'Fractionnement des congés (régime supplétif, jours ouvrables) ; jours au-delà de 24 exclus.'),
    ('L3141-19-1 et s.', 'Report des congés non pris en raison d’un arrêt maladie ou AT/MP.'),
    ('L3141-5 (mod. loi n° 2024-364, en vigueur le 24/04/2024)', 'Arrêt AT/MP assimilé à du travail effectif, sans limite d’un an.'),
    ('L3141-5-1', 'Maladie non professionnelle : 2 jours ouvrables/mois, plafond 24 jours ouvrables.'),
    ('Syntec 5.1 (IDCC 1486)', '25 jours ouvrés = 30 jours ouvrables ; ancienneté 5/10/15/20 ans → +1/+2/+3/+4 jours ouvrés ; fractionnement en jours ouvrés.'),
    ('Syntec 5.3', 'Acquisition du 1er juin au 31 mai ; prise à partir du 1er mai ; période de prise de 13 mois maximum.'),
    ('Syntec 5.5', 'Périodes assimilées à du travail effectif.'),
    ('Syntec 5.7', 'Congés pour événements familiaux.'),
    ('Service-Public.fr F37482', 'Report de 15 mois ; suppression de la limite d’un an pour AT/MP.'),
    ('Règles internes GMES', 'Prévenance 30/60 jours, seuil 21 jours, période estivale 01/05 → 31/10, décompte du samedi, prorata BAL-009, transfert N → N-1.'),
]

# Chaque scénario : id, prio, scénario, rôle, préconditions, étapes, résultat
# attendu, preuve, statut, résultat obtenu, commentaire, date de test.
S = []
def add(id_, prio, scen, role, precond, steps, expected, proof, status, obtained, comment, dtest):
    S.append(dict(id=id_, prio=prio, scen=scen, role=role, precond=precond,
                  steps=steps, expected=expected, proof=proof, status=status,
                  obtained=obtained, comment=comment, dtest=dtest))

JEST = 'Jest — exécution du 20/10/2026 : 334 tests OK / 38 ignorés / 372 au total (26 suites)'
CONF_SPEC = 'Jest — conformite-legale.spec.ts'
ROUND_SPEC = 'Jest — reference-period-rounding.util.spec.ts'
PERIOD_SPEC = 'Jest — reference-period.util.spec.ts'
ACCRUAL_SPEC = 'Jest — monthly-accrual.service.spec.ts'
BAL009_PROOF = 'retest-bal009-prorata.json + retest-bal009-ui.json'
ARRONDI_SCRIPT = 'tests/recette/scripts/retest-arrondi-l3141-7.mjs (11 contrôles)'
ARRONDI_CAS_SCRIPT = 'tests/recette/scripts/retest-arrondi-l3141-7-cas.mjs (18 contrôles)'

# --- A. Congés payés (acquisition et décompte) ---
add('JUR-001', 'P1',
    'Acquisition mensuelle de 2,5 jours ouvrables par mois de travail effectif — Réf. L3141-3',
    'RH',
    'Période de référence 2026-2027 ouverte ; collaborateur actif embauché avant le 01/06/2026 ; taux mensuel configuré à 2,50 jours ; base gestion_conges_gmes_test.',
    ['Lancer l’acquisition mensuelle (POST /leave-balances/accrual/run) pour un mois complet (ex. août 2026).',
     'Consulter le compteur N du collaborateur (GET /leave-balances/employee/:id?referencePeriod=2026-2027&counterType=N).',
     'Vérifier le mouvement d’ACQUISITION créé.'],
    'Un mouvement d’ACQUISITION de +2,50 jours ouvrables est crédité pour un mois complet de travail effectif ; le cumul annuel plafonne à 30 jours ouvrables.',
    ACCRUAL_SPEC + ' + ' + CONF_SPEC,
    'Conforme',
    'Résultat obtenu : +2,50 jours ouvrables crédités par mois complet ; cumul plafonné à 30 jours ouvrables ; tests Jest OK (334/334).',
    '', DATE)

add('JUR-002', 'P1',
    'Plafond de 30 jours ouvrables de congés payés de base — Réf. L3141-3',
    'RH',
    'Collaborateur à temps plein présent sur toute la période 2026-2027 ; taux 2,50 j/mois.',
    ['Exécuter les 12 acquisitions mensuelles complètes (juin 2026 → mai 2027).',
     'Consulter le droit acquis (acquiredDays) en fin de période.'],
    'acquiredDays = 30 jours ouvrables maximum ; aucun dépassement à 31 jours.',
    ROUND_SPEC + ' (plafond 30)',
    'Conforme',
    'Résultat obtenu : acquiredDays plafonné à 30 jours ouvrables ; roundAcquiredDaysUp(30,99) = 30 et roundAcquiredDaysUp(31) = 30.',
    '', DATE)

add('JUR-003', 'P1',
    'Décompte en jours ouvrables : semaine complète + samedi GMES — Réf. L3141-3 et règle interne GMES',
    'Multi-rôles',
    'Demande de congé du lundi 05/01/2026 au vendredi 09/01/2026 après-midi.',
    ['Créer la demande de congé (lundi 05/01 → vendredi 09/01 après-midi).',
     'Vérifier le décompte calculé (calculateDeductedLeaveDays).'],
    '5 jours ouvrables (lundi → vendredi) + samedi 10/01 décompté (règle interne GMES) = 6 jours.',
    CONF_SPEC,
    'Conforme',
    'Résultat obtenu : décompte = 6 jours (5 jours ouvrables + samedi GMES) ; vérifié par test Jest.',
    'Le décompte du samedi est une règle interne GMES, distincte du décompte légal en jours ouvrables.', DATE)

add('JUR-004', 'P1',
    'Le dimanche n’est jamais décompté — Réf. L3141-2 / L3141-3 (jour non ouvrable)',
    'Multi-rôles',
    'Congé posé le dimanche 04/01/2026 uniquement.',
    ['Poser un congé sur le seul dimanche 04/01/2026.',
     'Vérifier le décompte.'],
    '0 jour décompté (le dimanche n’est pas un jour ouvrable).',
    CONF_SPEC,
    'Conforme',
    'Résultat obtenu : décompte = 0 jour pour un dimanche seul.',
    '', DATE)

add('JUR-005', 'P1',
    'Jour férié non décomptable exclu du décompte — Réf. L3133-1 / L3141-3',
    'Multi-rôles',
    'Jour férié déclaré non décomptable le lundi 02/11/2026 ; congé du 02/11/2026 au 03/11/2026.',
    ['Déclarer le 02/11/2026 comme jour non décomptable.',
     'Poser un congé du lundi 02/11/2026 au mardi 03/11/2026.',
     'Vérifier le décompte.'],
    'Le 02/11 (jour férié non décomptable) est exclu ; décompte = 1 jour ouvrable (03/11).',
    CONF_SPEC,
    'Conforme',
    'Résultat obtenu : décompte = 1 jour (jour férié exclu).',
    '', DATE)

add('JUR-006', 'P1',
    'Prise en demi-journée (MATIN / APRES_MIDI) — Réf. L3141-3',
    'Multi-rôles',
    'Congé du 05/01/2026 au 06/01/2026 saisi en demi-journées.',
    ['Poser un congé débutant l’après-midi du 05/01/2026 et se terminant l’après-midi du 06/01/2026.',
     'Vérifier le décompte.'],
    'Début après-midi = 0,5 jour ; jour suivant complet = 1 jour ; total = 1,5 jour. Fin le matin = 0,5 jour.',
    CONF_SPEC,
    'Conforme',
    'Résultat obtenu : début après-midi + jour complet = 1,5 jour ; fin matin = 0,5 jour.',
    '', DATE)

add('JUR-007', 'P2',
    'Période d’acquisition du 1er juin au 31 mai — Réf. L3141-5 / Syntec 5.3 / config GMES',
    'RH',
    'Paramètre REFERENCE_PERIOD_START = 06-01.',
    ['Vérifier currentReferencePeriod aux dates 31/05/2026 et 01/06/2026.',
     'Vérifier les bornes de la période 2026-2027.'],
    '31/05/2026 → période 2025-2026 ; 01/06/2026 → 2026-2027 ; bornes 01/06/2026 → 31/05/2027.',
    PERIOD_SPEC,
    'Conforme',
    'Résultat obtenu : 31/05/2026 → 2025-2026 ; 01/06/2026 → 2026-2027 ; bornes conformes.',
    '', DATE)

add('JUR-008', 'P2',
    'Prorata d’arrivée en cours de période — Réf. BAL-009 (règle interne GMES)',
    'RH',
    'Collaborateur embauché le 16/07/2026 ; taux mensuel 2,50 j/mois.',
    ['Exécuter l’acquisition de juillet 2026.',
     'Vérifier le crédit du mois de juillet.'],
    'Prorata calendaire GMES : 2,50 × 16/31 = 1,29 jour (jour d’arrivée inclus) ; crédit de 1,29 jour.',
    BAL009_PROOF,
    'Conforme',
    'Résultat obtenu : crédit de 1,29 jour pour une arrivée le 16/07 (cas de référence BAL-009).',
    'Le prorata calendaire est une règle applicative GMES, pas une obligation légale générale.', DATE)

add('JUR-009', 'P2',
    'Prorata de départ en cours de période — Réf. BAL-009 (règle interne GMES)',
    'RH',
    'Collaborateur avec date de sortie au 15/07/2026 ; taux mensuel 2,50 j/mois.',
    ['Enregistrer la date de sortie au 15/07/2026.',
     'Exécuter l’acquisition de juillet 2026.',
     'Vérifier le crédit.'],
    'Prorata calendaire GMES : 2,50 × 15/31 = 1,21 jour (jour de départ inclus) ; crédit de 1,21 jour.',
    BAL009_PROOF,
    'Conforme',
    'Résultat obtenu : crédit de 1,21 jour pour un départ le 15/07 (cas de référence BAL-009).',
    '', DATE)

add('JUR-010', 'P1',
    'Arrondi légal L3141-7 : droit acquis porté à l’entier supérieur — Réf. L3141-7',
    'RH',
    'Collaborateur embauché le 16/07/2026 ; droit brut = 26,29 jours ouvrables.',
    ['Vérifier roundAcquiredDaysUp(26,29).',
     'Vérifier que l’arrondi porte sur le droit acquis (acquiredDays), jamais sur le solde restant (availableDays).'],
    '26,29 → 27 jours ouvrables définitifs (entier immédiatement supérieur) ; le solde restant n’est pas arrondi à la hausse par L3141-7.',
    ROUND_SPEC,
    'Conforme',
    'Résultat obtenu : roundAcquiredDaysUp(26,29) = 27 ; roundPeriodCloseDays (solde restant) reste distinct.',
    '', DATE)

add('JUR-011', 'P1',
    'Arrondi L3141-7 plafonné à 30 jours ouvrables — Réf. L3141-7 + L3141-3',
    'RH',
    'Droit acquis proche ou égal au plafond légal.',
    ['Vérifier roundAcquiredDaysUp sur 29,01, 30,99 et 31.'],
    '29,01 → 30 ; 30,99 → 30 ; 31 → 30 ; l’arrondi ne dépasse jamais le plafond de 30 jours ouvrables.',
    ROUND_SPEC,
    'Conforme',
    'Résultat obtenu : 29,01 → 30 ; 30,99 → 30 ; 31 → 30 (plafond respecté).',
    '', DATE)

# --- B. Arrondi légal et transfert N -> N-1 (cycle de clôture, intégration) ---
add('JUR-012', 'P1',
    'Clôture : supplément d’arrondi +0,71 (26,29 → 27) et mouvement tracé — Réf. L3141-7',
    'RH',
    'Période 2024-2025 ; collaborateur embauché le 16/07/2024 (droit brut 26,29 jours ouvrables).',
    ['Exécuter la clôture de période (POST /leave-balances/period/close, referencePeriod=2024-2025).',
     'Vérifier roundingSupplement, transferredFromN et le mouvement CLOTURE_ARRONDI_L3141_7.',
     'Vérifier le compteur N-1 de la période 2025-2026.'],
    'Supplément d’arrondi +0,71 (26,29 → 27) ; transfert N → N-1 = 27 ; mouvement CLOTURE_ARRONDI_L3141_7 tracé (+0,71) ; N-1 2025-2026 reçoit 27 jours.',
    ARRONDI_SCRIPT,
    'A tester',
    'Non exécuté dans la présente campagne (à rejouer sur l’environnement de recette).',
    'Script disponible ; exécution antérieure rapportée 11/11, preuve JSON non archivée dans tests/recette/reports. À ré-exécuter pour archivage.', '')

add('JUR-013', 'P1',
    'Règle GMES de transfert N → N-1 inchangée (distincte de l’arrondi légal L3141-7)',
    'RH',
    '26,5 jours disponibles en N après consommation (solde disponible).',
    ['Vérifier roundPeriodCloseDays(26,5).',
     'Vérifier que cette règle s’applique au solde disponible transféré, pas au droit acquis.'],
    '26,5 jours disponibles → 27 jours transférés en N-1 (arrondi au plus proche du solde disponible, règle GMES). Cette règle est distincte de l’arrondi légal L3141-7 et ne constitue pas une anomalie.',
    ROUND_SPEC + ' (roundPeriodCloseDays)',
    'Conforme',
    'Résultat obtenu : roundPeriodCloseDays(26,5) = 27 ; règle GMES de transfert inchangée.',
    'Décision métier validée : la règle GMES de transfert reste inchangée et ne doit pas être présentée comme une anomalie.', DATE)

add('JUR-014', 'P1',
    'Traçabilité : un seul mouvement d’arrondi par salarié (absence de double attribution) — Réf. L3141-7',
    'RH',
    'Période 2023-2024 ; plusieurs collaborateurs de cas (consommation, corrections, solde négatif).',
    ['Clôturer la période 2023-2024.',
     'Compter les mouvements CLOTURE_ARRONDI_L3141_7 par salarié.'],
    'Exactement 1 mouvement d’arrondi par salarié ; aucune double attribution.',
    ARRONDI_CAS_SCRIPT,
    'A tester',
    'Non exécuté dans la présente campagne (à rejouer sur l’environnement de recette).',
    'Script disponible ; exécution antérieure rapportée 18/18, preuve JSON non archivée. À ré-exécuter pour archivage.', '')

add('JUR-015', 'P1',
    'Réservations bloquant la clôture (aucun supplément pendant le blocage) — Réf. L3141-7 + règle GMES',
    'RH',
    'Période 2023-2024 ; un collaborateur avec des jours réservés.',
    ['Tenter la clôture alors qu’un collaborateur possède des jours réservés.',
     'Vérifier le refus et l’absence de supplément d’arrondi.',
     'Libérer la réservation puis clôturer.'],
    'Clôture refusée (HTTP 400) tant que des jours sont réservés ; aucun supplément d’arrondi appliqué pendant le blocage ; clôture acceptée après libération.',
    ARRONDI_CAS_SCRIPT,
    'A tester',
    'Non exécuté dans la présente campagne (à rejouer sur l’environnement de recette).',
    'Script disponible ; exécution antérieure rapportée. À ré-exécuter pour archivage.', '')

add('JUR-016', 'P2',
    'Solde négatif conservé après clôture (non remis à zéro) — Réf. règle GMES',
    'RH',
    'Période 2023-2024 ; un collaborateur en solde négatif (-3,71 avant arrondi).',
    ['Clôturer la période.',
     'Vérifier le solde N après clôture.',
     'Vérifier la notification RH.'],
    'Le solde N négatif est conservé sur la période clôturée (ex. -3 après arrondi) ; notification RH « Solde négatif à contrôler » émise.',
    ARRONDI_CAS_SCRIPT,
    'A tester',
    'Non exécuté dans la présente campagne (à rejouer sur l’environnement de recette).',
    'Les états consommés/réservés sont préparés par SQL dans la base de recette : ce contrôle ne constitue pas une validation complète du circuit métier.', '')

add('JUR-017', 'P2',
    'Idempotence de la clôture (seconde clôture refusée) — Réf. règle GMES',
    'RH',
    'Période 2024-2025 déjà clôturée.',
    ['Tenter une seconde clôture de la même période.',
     'Vérifier la réponse.'],
    'Seconde clôture refusée (HTTP 409) ; aucun nouveau mouvement créé.',
    ARRONDI_SCRIPT + ' + ' + ARRONDI_CAS_SCRIPT,
    'A tester',
    'Non exécuté dans la présente campagne (à rejouer sur l’environnement de recette).',
    'Script disponible ; exécution antérieure rapportée. À ré-exécuter pour archivage.', '')

add('JUR-018', 'P2',
    'Corrections RH (+3 / -5) prises en compte avant l’arrondi — Réf. L3141-7 + règle GMES',
    'RH',
    'Période 2023-2024 ; droit brut 26,29 ; correction RH +3 puis -5 sur deux collaborateurs distincts.',
    ['Appliquer une correction +3 (POST /leave-balances/:id/correction).',
     'Appliquer une correction -5 sur un autre collaborateur.',
     'Clôturer et vérifier les droits définitifs.'],
    'Correction +3 → droit 29,29 → 30 après arrondi ; correction -5 → 21,29 → 22 après arrondi.',
    ARRONDI_CAS_SCRIPT,
    'A tester',
    'Non exécuté dans la présente campagne (à rejouer sur l’environnement de recette).',
    'Script disponible ; exécution antérieure rapportée. À ré-exécuter pour archivage.', '')

# --- C. Convention Syntec (applicabilité à confirmer) ---
add('JUR-019', 'P2',
    'Congés d’ancienneté Syntec 5.1 : +1/+2/+3/+4 jours ouvrés (5/10/15/20 ans) — Réf. Syntec 5.1 (IDCC 1486)',
    'RH / Juridique',
    'Applicabilité de la convention Syntec à l’entreprise confirmée ; ancienneté du collaborateur connue.',
    ['Vérifier l’ancienneté du collaborateur.',
     'Vérifier l’attribution des jours d’ancienneté selon le palier (5/10/15/20 ans).'],
    '5 ans → +1 jour ouvré ; 10 ans → +2 ; 15 ans → +3 ; 20 ans → +4 jours ouvrés supplémentaires.',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ B',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Absent de l’application (scénario it.skip, non implémenté). Applicabilité Syntec à confirmer pour chaque entreprise (GMES, Efficience, GMES Ingénierie).', '')

add('JUR-020', 'P2',
    'Ancienneté appréciée à l’ouverture de la période de prise (1er mai) — Réf. Syntec 5.1',
    'RH / Juridique',
    'Applicabilité Syntec confirmée ; période de prise ouverte.',
    ['Vérifier la date d’appréciation de l’ancienneté utilisée pour les jours d’ancienneté.'],
    'L’ancienneté est appréciée à l’ouverture de la période de prise (1er mai à défaut de stipulation différente).',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ B',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; applicabilité Syntec à confirmer.', '')

add('JUR-021', 'P2',
    'Fractionnement Syntec 5.1 en jours ouvrés — Réf. Syntec 5.1',
    'RH / Juridique',
    'Applicabilité Syntec confirmée ; congé principal pris hors période légale.',
    ['Poser 3 ou 4 jours ouvrés hors période puis vérifier le supplément.',
     'Poser au moins 5 jours ouvrés hors période puis vérifier.',
     'Vérifier l’exclusion de la 5e semaine.'],
    '3-4 jours ouvrés hors période → +1 jour ouvré ; au moins 5 jours ouvrés hors période → +2 jours ouvrés ; 5e semaine exclue.',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ C',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; applicabilité Syntec à confirmer.', '')

add('JUR-022', 'P2',
    'Fractionnement — régime légal supplétif L3141-23 (jours ouvrables) — Réf. L3141-23',
    'RH / Juridique',
    'Régime supplétif applicable (pas de disposition conventionnelle ou d’accord plus favorable).',
    ['Poser 3 à 5 jours ouvrables hors période puis vérifier le supplément.',
     'Poser au moins 6 jours ouvrables hors période puis vérifier.',
     'Vérifier l’exclusion des jours au-delà de 24 jours ouvrables.'],
    '3 à 5 jours ouvrables hors période → +1 jour ouvrable ; au moins 6 jours → +2 jours ouvrables ; jours au-delà de 24 jours ouvrables (5e semaine) exclus.',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ C',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Régime supplétif ; non implémenté. À confirmer avec la RH selon l’accord d’entreprise éventuel.', '')

add('JUR-023', 'P2',
    'Période de prise Syntec 5.3 : 13 mois maximum, départ au 1er mai — Réf. Syntec 5.3',
    'RH / Juridique',
    'Applicabilité Syntec confirmée.',
    ['Vérifier la date de démarrage de la période de prise.',
     'Vérifier la durée maximale de prise (13 mois) et le report au-delà.'],
    'La prise démarre, sauf stipulation différente, le 1er mai ; période de prise de 13 mois maximum ; report au-delà sur demande écrite de l’employeur.',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ E',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; l’application ne doit pas supprimer des droits encore légalement reportables.', '')

add('JUR-024', 'P2',
    'Dispositions conventionnelles plus favorables que la loi — Réf. Syntec / accords d’entreprise',
    'RH / Juridique',
    'Comparaison Code du travail vs Syntec vs accord d’entreprise à réaliser.',
    ['Comparer les durées et conditions de congés entre les textes.',
     'Vérifier que l’application applique la disposition la plus favorable.'],
    'La disposition la plus favorable au salarié est appliquée ; aucun accord d’entreprise n’est présumé.',
    'Analyse RH / juridique',
    'Bloqué',
    'Non vérifié : dépend de l’applicabilité Syntec et des accords d’entreprise.',
    'À confirmer avec la RH pour chaque entreprise de rattachement ; ne pas présumer l’existence d’accords.', '')

# --- D. Arrêts maladie ---
add('JUR-025', 'P1',
    'Acquisition pendant un arrêt AT/MP sans limite de durée — Réf. L3141-5 (mod. loi n° 2024-364, en vigueur le 24/04/2024)',
    'RH / Paie',
    'Collaborateur en arrêt accident du travail ou maladie professionnelle.',
    ['Déclarer un arrêt AT/MP.',
     'Vérifier l’acquisition de congés pendant l’arrêt.'],
    'L’arrêt AT/MP est assimilé à du travail effectif sans limite d’un an (limite supprimée depuis le 24/04/2024).',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ D',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; arbitrage RH requis (compteurs logiciel vs paie). La loi ayant supprimé la limite d’un an, le plancher légal sans limite prévaut.', '')

add('JUR-026', 'P1',
    'Acquisition pendant une maladie non professionnelle : 2 jours/mois, plafond 24 jours — Réf. L3141-5-1',
    'RH / Paie',
    'Collaborateur en arrêt maladie non professionnelle.',
    ['Déclarer un arrêt maladie non professionnelle.',
     'Vérifier l’acquisition pendant l’arrêt.'],
    '2 jours ouvrables par mois d’arrêt, plafond 24 jours ouvrables.',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ D',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; arbitrage RH requis (compteurs logiciel vs paie).', '')

add('JUR-027', 'P1',
    'Report des congés non pris en raison d’un arrêt maladie / AT-MP — Réf. L3141-19-1 et s. + Service-Public F37482',
    'RH',
    'Collaborateur n’ayant pas pu prendre ses congés en raison d’un arrêt maladie / AT-MP.',
    ['Vérifier le report des congés non pris.',
     'Vérifier le délai de report.'],
    'Les congés non pris pour maladie / AT-MP sont reportés ; délai de report de 15 mois (Service-Public F37482).',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ D',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; à ne pas confondre avec le transfert GMES N → N-1.', '')

add('JUR-028', 'P2',
    'Interaction arrêt maladie avec congés déjà posés — Réf. L3141-19-1 et s.',
    'RH',
    'Collaborateur avec un congé posé, puis un arrêt maladie sur la même période.',
    ['Poser un congé.',
     'Déclarer un arrêt maladie chevauchant le congé.',
     'Vérifier le traitement des jours.'],
    'Les jours de congé couverts par l’arrêt maladie ne sont pas perdus et sont reportables selon les textes applicables.',
    'Analyse RH / juridique',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; arbitrage RH requis.', '')

# --- E. Événements familiaux et parentalité ---
add('JUR-029', 'P2',
    'Congés pour événements familiaux (mariage/Pacs, naissance, adoption, décès, maladie d’un enfant) — Réf. Syntec 5.7 + Code du travail',
    'RH',
    'Collaborateur concerné par un événement familial ; justificatif le cas échéant.',
    ['Déclarer l’événement familial.',
     'Vérifier l’autorisation d’absence et sa durée selon les textes applicables.'],
    'L’absence est autorisée selon les durées prévues par les textes applicables (Code du travail et/ou Syntec 5.7).',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ F',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; durées à vérifier sur Légifrance (Syntec 5.7) avant toute mise en œuvre.', '')

add('JUR-030', 'P2',
    'Congé de deuil et annonce d’un handicap ou d’une pathologie grave d’un enfant — Réf. Code du travail / Syntec 5.7',
    'RH',
    'Collaborateur concerné par un deuil ou l’annonce d’un handicap/pathologie grave d’un enfant.',
    ['Déclarer l’événement.',
     'Vérifier l’autorisation d’absence.'],
    'Autorisation d’absence conforme aux textes applicables.',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ F',
    'Bloqué',
    'Fonctionnalité non gérée par l’application.',
    'Non implémenté ; durées à vérifier sur Légifrance.', '')

add('JUR-031', 'P2',
    'Congés maternité, paternité et accueil de l’enfant, adoption (déclaratif) — Réf. Code du travail / Syntec 5.5',
    'RH',
    'Collaboratrice/collaborateur en congé maternité, paternité ou adoption.',
    ['Déclarer le congé.',
     'Vérifier la prise en compte déclarative et l’interaction avec les compteurs de congés.'],
    'Le congé est enregistré de façon déclarative ; les périodes sont assimilées à du travail effectif selon Syntec 5.5.',
    'conformite-legale.spec.ts — describe.skip CONFORMITÉ H',
    'Bloqué',
    'Fonctionnalité non gérée par l’application (déclaratif uniquement).',
    'Non implémenté.', '')

add('JUR-032', 'P2',
    'Évolutions conventionnelles Syntec en vigueur en 2026 (ex. congé supplémentaire de naissance) — Réf. Syntec (version en vigueur 2026)',
    'RH / Juridique',
    'Version en vigueur de la convention Syntec identifiée sur Légifrance.',
    ['Identifier la version en vigueur de Syntec au 20/10/2026.',
     'Vérifier les nouvelles dispositions applicables (ex. congé supplémentaire de naissance).'],
    'Les dispositions 2026 en vigueur sont identifiées et vérifiées avant toute mise en œuvre.',
    'Légifrance — convention Syntec (IDCC 1486)',
    'Bloqué',
    'Non vérifié : dépend de la version en vigueur de la convention.',
    'À confirmer sur Légifrance ; ne pas présumer l’applicabilité.', '')

# --- F. Règles internes GMES ---
add('JUR-033', 'P1',
    'Délais de prévenance 30/60 jours et seuil de 21 jours — Réf. règle interne GMES (pas une obligation légale)',
    'Multi-rôles',
    'Configuration GMES : délai normal 30 jours, délai spécial 60 jours, seuil congé long 21 jours.',
    ['Évaluer la prévenance pour 21 jours calendaires.',
     'Évaluer la prévenance pour 20 jours calendaires.'],
    '21 jours calendaires → 60 jours ; 20 jours → 30 jours. Ces seuils sont des règles internes GMES, pas des délais légaux.',
    CONF_SPEC + ' (CONFORMITÉ G)',
    'Conforme',
    'Résultat obtenu : 21 jours → 60 jours ; 20 jours → 30 jours (tests Jest OK).',
    'Règle interne GMES, distincte des obligations légales.', DATE)

add('JUR-034', 'P1',
    'Période estivale 01/05 → 31/10 — Réf. règle interne GMES',
    'Multi-rôles',
    'Configuration GMES : période estivale du 01/05 au 31/10.',
    ['Évaluer un congé se terminant le 30/04.',
     'Évaluer un congé débutant le 01/05.',
     'Évaluer un congé se terminant le 31/10 et un débutant le 01/11.'],
    'Fin au 30/04 → hors période estivale (30 jours) ; début au 01/05 → période estivale (60 jours) ; fin au 31/10 → période estivale ; début au 01/11 → hors période.',
    CONF_SPEC + ' (CONFORMITÉ G)',
    'Conforme',
    'Résultat obtenu : bornes 01/05 et 31/10 correctement gérées (tests Jest OK).',
    'Règle interne GMES.', DATE)

add('JUR-035', 'P2',
    'Clôture et transferts : cycle complet de clôture de période — Réf. règle interne GMES',
    'RH',
    'Période 2024-2025 à clôturer ; collaborateurs avec soldes positifs, négatifs et réservations.',
    ['Préparer les compteurs.',
     'Clôturer la période.',
     'Vérifier les transferts, les remises à zéro et les notifications.'],
    'Droits N disponibles transférés vers N-1 ; soldes positifs remis à zéro ; solde négatif conservé ; notification de clôture émise.',
    ARRONDI_SCRIPT + ' + ' + ARRONDI_CAS_SCRIPT,
    'A tester',
    'Non exécuté dans la présente campagne (à rejouer sur l’environnement de recette).',
    'Les états sont préparés par SQL : ce contrôle ne constitue pas une validation complète du circuit métier.', '')

add('JUR-036', 'P2',
    'Décompte du samedi et demi-journées — Réf. règle interne GMES',
    'Multi-rôles',
    'Demandes de congé sur des semaines complètes et en demi-journées.',
    ['Poser une semaine complète (lundi → vendredi).',
     'Poser des demi-journées MATIN / APRES_MIDI.'],
    'Le samedi est décompté en fin de semaine complète (règle GMES) ; les demi-journées sont décomptées à 0,5 jour.',
    CONF_SPEC,
    'Conforme',
    'Résultat obtenu : samedi décompté (6 jours pour une semaine complète) ; demi-journées = 0,5 jour (tests Jest OK).',
    'Le décompte du samedi est une règle interne GMES, distincte du régime légal.', DATE)

# ---------------------------------------------------------------------------
# Helpers python-docx
# ---------------------------------------------------------------------------

def set_run_text(run, text):
    r = run._r
    for child in list(r):
        if child.tag in (qn('w:t'), qn('w:br'), qn('w:tab')):
            r.remove(child)
    t = _el('t')
    t.set(qn('xml:space'), 'preserve')
    t.text = text
    r.append(t)

def set_simple_cell(cell, text):
    """Remplit une cellule avec un texte simple en conservant la 1re mise en forme."""
    paras = cell.paragraphs
    p = paras[0]
    runs = p.runs
    if runs:
        set_run_text(runs[0], text)
        for r in runs[1:]:
            r._r.getparent().remove(r._r)
    else:
        run = p.add_run(text)
    # supprime d'éventuels paragraphes supplémentaires
    for extra in paras[1:]:
        extra._p.getparent().remove(extra._p)

def clear_tc(tc):
    for p in tc.findall(qn('w:p')):
        tc.remove(p)

def make_run(rpr, parts):
    """parts : liste de tuples ('t', text) ou ('br', None)."""
    r = _el('r')
    if rpr is not None:
        r.append(deepcopy(rpr))
    for kind, val in parts:
        if kind == 'br':
            r.append(_el('br'))
        elif kind == 't':
            t = _el('t')
            t.set(qn('xml:space'), 'preserve')
            t.text = val
            r.append(t)
    return r

def add_para(tc):
    p = _el('p')
    tc.append(p)
    return p

def get_rpr(tc):
    r = tc.find('.//' + qn('w:r'))
    rpr = r.find(qn('w:rPr')) if r is not None else None
    return deepcopy(rpr) if rpr is not None else None

def fill_row(row_el, scen):
    tcs = row_el.findall(qn('w:tc'))
    rpr = get_rpr(tcs[0])

    # 0 ID, 1 Prio, 2 Scénario, 3 Rôle, 5 Résultat attendu, 6 Preuve
    simple = {0: scen['id'], 1: scen['prio'], 2: scen['scen'],
              3: scen['role'], 5: scen['expected'], 6: scen['proof']}
    for idx, val in simple.items():
        tc = tcs[idx]
        clear_tc(tc)
        p = add_para(tc)
        p.append(make_run(rpr, [('t', val)]))

    # 4 Préconditions et procédure (2 paragraphes)
    tc = tcs[4]
    clear_tc(tc)
    p0 = add_para(tc)
    p0.append(make_run(rpr, [('t', 'Préconditions : ' + scen['precond'])]))
    p1 = add_para(tc)
    p1.append(make_run(rpr, [('br', None), ('t', 'Étapes :')]))
    for step in scen['steps']:
        p1.append(make_run(rpr, [('br', None), ('t', step)]))

    # 7 Résultat / statut (1 paragraphe avec sauts de ligne)
    tc = tcs[7]
    clear_tc(tc)
    p = add_para(tc)
    obt = scen['obtained']
    if not obt.startswith('Résultat obtenu : '):
        obt = 'Résultat obtenu : ' + obt
    p.append(make_run(rpr, [('t', obt)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Statut : ' + scen['status'])]))
    p.append(make_run(rpr, [('br', None), ('t', 'Commentaire : ' + scen['comment'])]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Date de test : ' + scen['dtest'])]))
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : D.RAMPONT')]))

def insert_row_before(table, ref_tr, tr):
    ref_tr.addprevious(tr)

# ---------------------------------------------------------------------------
# Ouverture de la copie
# ---------------------------------------------------------------------------
shutil.copy2(SRC, DST)
doc = docx.Document(DST)

# --- 1) Table 1 — Informations du document ---
info = doc.tables[1]
for r in info.rows:
    k = r.cells[0].text.strip()
    if k == 'Version':
        set_simple_cell(r.cells[1], VERSION)
    elif k == 'Date':
        set_simple_cell(r.cells[1], DATE)
    elif k == 'Statut du document':
        set_simple_cell(r.cells[1],
                        'Recette historique acceptée (420/420) — campagne juridique complémentaire (module 20) en cours.')

# --- 2) Table 2 — Historique des versions : ajouter v2.0 ---
hist = doc.tables[2]
new = hist.add_row()
vals = [VERSION, DATE, AUTEUR,
        'Ajout du module 20 « Conformité juridique — Droit français et convention collective Syntec » (36 scénarios JUR) ; intégration des vérifications Jest (334 OK / 38 ignorés / 372 total) et des scripts d’intégration L3141-7 ; actualisation de la synthèse.',
        'Recette historique acceptée (420/420) ; campagne juridique complémentaire à finaliser (15 conformes, 7 à tester, 14 bloqués).']
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# --- 3) Table 6 — Synthèse des scénarios : module 20 + TOTAL ---
syn = doc.tables[6]
rows = syn.rows
total_tr = rows[-1]._tr
# insérer une ligne module 20 (copie d'une ligne de module existante)
tpl_tr = deepcopy(rows[1]._tr)
module_tr = deepcopy(tpl_tr)
mcs = module_tr.findall(qn('w:tc'))
set_simple_cell_cell = None
# remplissage manuel des 4 cellules de la ligne module 20
def _set_tc(tc, text):
    paras = tc.findall(qn('w:p'))
    p = paras[0]
    runs = p.findall(qn('w:r'))
    if runs:
        # set first w:t
        t = runs[0].find(qn('w:t'))
        if t is None:
            t = _el('t'); runs[0].append(t)
        t.set(qn('xml:space'), 'preserve'); t.text = text
        for extra in runs[1:]:
            p.remove(extra)
    else:
        r = _el('r'); t = _el('t'); t.set(qn('xml:space'), 'preserve'); t.text = text; r.append(t); p.append(r)
_set_tc(mcs[0], '20. Conformité juridique — Droit français et convention collective Syntec')
_set_tc(mcs[1], '17')
_set_tc(mcs[2], '19')
_set_tc(mcs[3], '36')
total_tr.addprevious(module_tr)
# mise à jour du TOTAL
tot_cells = total_tr.findall(qn('w:tc'))
new_p1 = 259 + 17
new_p2 = 161 + 19
new_total = 420 + 36
_set_tc(tot_cells[1], str(new_p1))
_set_tc(tot_cells[2], str(new_p2))
_set_tc(tot_cells[3], str(new_total))

# --- 4) Table 28 — Synthèse et décision ---
dec = doc.tables[28]
def _set_decision(cell, text):
    set_simple_cell(cell, text)
for r in dec.rows:
    k = r.cells[0].text.strip()
    if k == 'Nombre total de scénarios':
        _set_decision(r.cells[1], str(new_total))
    elif k == 'Scénarios conformes':
        _set_decision(r.cells[1], '435')
    elif k == 'Scénarios bloqués':
        _set_decision(r.cells[1], '14')
    elif k == 'Scénarios restant à tester':
        _set_decision(r.cells[1], '7')
    elif k == 'Taux de réussite':
        _set_decision(r.cells[1], '95,4 % (435 conformes / 456 scénarios ; 21 scénarios non exécutés : 7 à tester, 14 bloqués)')

# --- 5) Construction du module 20 (avant le paragraphe de fin de section 1) ---
# La section paysage (section 1) se termine par d.paragraphs[167] (paragraphe contenant le sectPr).
section1_end_p = None
for p in doc.paragraphs:
    ppr = p._p.find(qn('w:pPr'))
    if ppr is not None and ppr.find(qn('w:sectPr')) is not None:
        # le second paragraphe avec sectPr termine la section paysage
        if section1_end_p is not None:
            section1_end_p = p
            break
        section1_end_p = p
anchor = section1_end_p._p

# Titre du module (copie du titre du module 19)
heading_src = doc.paragraphs[165]._p
heading = deepcopy(heading_src)
for bm in heading.findall(qn('w:bookmarkStart')):
    bm.set(qn('w:id'), '500')
    bm.set(qn('w:name'), '_Toc241593233')
for bm in heading.findall(qn('w:bookmarkEnd')):
    bm.set(qn('w:id'), '500')
# texte du titre
runs = heading.findall(qn('w:r'))
set_run_text_el = None
r0 = runs[0]
for child in list(r0):
    if child.tag in (qn('w:t'), qn('w:br')):
        r0.remove(child)
t = _el('t'); t.set(qn('xml:space'), 'preserve'); t.text = MODULE_TITLE; r0.append(t)

# Description du module (copie de la description du module 19)
desc_src = doc.paragraphs[166]._p
desc = deepcopy(desc_src)
druns = desc.findall(qn('w:r'))
dr0 = druns[0]
for child in list(dr0):
    if child.tag in (qn('w:t'), qn('w:br')):
        dr0.remove(child)
t = _el('t'); t.set(qn('xml:space'), 'preserve'); t.text = MODULE_DESC; dr0.append(t)

# Table de correspondance juridique (copie de la table légende T05, 2 colonnes)
corr_src = doc.tables[5]._tbl
corr_tbl = deepcopy(corr_src)
corr_trs = corr_tbl.findall(qn('w:tr'))
corr_header = corr_trs[0]
corr_tpl = deepcopy(corr_trs[1])
for tr in corr_trs[1:]:
    corr_tbl.remove(tr)
# en-tête
hcs = corr_header.findall(qn('w:tc'))
def _set_hdr(tc, text):
    paras = tc.findall(qn('w:p'))
    p = paras[0]
    runs = p.findall(qn('w:r'))
    r0 = runs[0]
    for child in list(r0):
        if child.tag in (qn('w:t'), qn('w:br')):
            r0.remove(child)
    t = _el('t'); t.set(qn('xml:space'), 'preserve'); t.text = text; r0.append(t)
_set_hdr(hcs[0], 'Référence juridique')
_set_hdr(hcs[1], 'Objet (texte vérifié sur Légifrance / Service-Public le 16/10/2026)')
for ref, obj in CORRESPONDANCE:
    tr = deepcopy(corr_tpl)
    ccs = tr.findall(qn('w:tc'))
    _set_tc(ccs[0], ref)
    _set_tc(ccs[1], obj)
    corr_tbl.append(tr)

# Table des scénarios (copie de la table module 19 T25)
scen_src = doc.tables[25]._tbl
scen_tbl = deepcopy(scen_src)
scen_trs = scen_tbl.findall(qn('w:tr'))
scen_header = scen_trs[0]
scen_tpl = deepcopy(scen_trs[1])
for tr in scen_trs[1:]:
    scen_tbl.remove(tr)
for scen in S:
    tr = deepcopy(scen_tpl)
    fill_row(tr, scen)
    scen_tbl.append(tr)

# Insertion avant la fin de section paysage.
# addprevious insère juste avant l'ancre : le dernier appel est le plus proche de l'ancre.
# Ordre final voulu : heading, desc, corr_tbl, scen_tbl, [ancre].
anchor.addprevious(heading)
anchor.addprevious(desc)
anchor.addprevious(corr_tbl)
anchor.addprevious(scen_tbl)

# --- 6) Entrée du sommaire (copie de l'entrée du module 19, P59) ---
toc_src = None
for p in doc.paragraphs:
    if p.text.strip().startswith('19. Ergonomie, responsive et non-régression visuelle'):
        toc_src = p._p
        break
toc_entry = deepcopy(toc_src)
# hyperlien
hl = toc_entry.find(qn('w:hyperlink'))
if hl is not None:
    hl.set(qn('w:anchor'), '_Toc241593233')
# instrText (imbriqué : recherche récursive)
for it in toc_entry.findall('.//' + qn('w:instrText')):
    it.text = ' PAGEREF _Toc241593233 \\h '
# w:t (1er = libellé, 2e = numéro de page)
ts = toc_entry.findall('.//' + qn('w:t'))
if len(ts) >= 1:
    ts[0].set(qn('xml:space'), 'preserve'); ts[0].text = '20. Conformité juridique — Droit français et convention collective Syntec'
if len(ts) >= 2:
    ts[1].set(qn('xml:space'), 'preserve'); ts[1].text = '999'
# insertion avant l'entrée « Registre des anomalies » du sommaire
reg_toc = None
for p in doc.paragraphs:
    if p.text.strip().startswith('Registre des anomalies'):
        reg_toc = p._p
        break
reg_toc.addprevious(toc_entry)

# --- 7) Paragraphes de décision ---
for p in doc.paragraphs:
    t = p.text
    if t.strip() == '☒ Recette validée sans réserve':
        for r in p.runs:
            if '☒' in r.text:
                r.text = r.text.replace('☒', '☐')
    elif t.strip() == '☐ Recette validée avec réserves':
        for r in p.runs:
            if '☐' in r.text:
                r.text = r.text.replace('☐', '☒')
    elif t.startswith('Recette exécutée du'):
        # remplace le texte en conservant la 1re mise en forme
        runs = p.runs
        if runs:
            set_run_text(runs[0],
                'Recette historique exécutée du 22/09/2026 au 12/10/2026 : LOT 1 à LOT 6, évolution fonctionnelle RH-only et BAL-009 validés, 420/420 scénarios conformes, aucune anomalie ouverte. '
                'Campagne juridique complémentaire (module 20) du 20/10/2026 : 36 scénarios ajoutés — 15 conformes (vérifiés par 334 tests Jest OK le 20/10/2026 et preuves BAL-009), 7 à tester (scripts d’intégration L3141-7 à ré-exécuter), 14 bloqués (fonctionnalités non gérées par l’application et/ou applicabilité Syntec à confirmer). '
                'La recette est validée avec réserves : les 420 scénarios historiques restent conformes ; la campagne juridique reste à finaliser.')
            for r in runs[1:]:
                r._r.getparent().remove(r._r)

doc.save(DST)
print('DOCX v2.0 enregistré :', DST)
print('Scénarios JUR :', len(S))
