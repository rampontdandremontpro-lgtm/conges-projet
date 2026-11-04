# -*- coding: utf-8 -*-
"""Mise à jour in place du cahier v2.12 : preuves JUR-029/030 après corrections
ciblées (versions légales annonce handicap, Syntec 5.7 complet, quotas, décision
RH motivée, concurrence)."""
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.12.docx'
DST = SRC
DATE = '30/10/2026'
TESTEUR = 'Pi — test automatisé'

PROOF = (
    'tests/recette/scripts/retest-jur029-030-e2e.mjs (39/39 OK) ; '
    'retest-jur029-030-corrections.mjs (42/42 OK) ; '
    '_ui-jur029-030.mjs (navigateur, 6/6 OK) ; '
    'retest-jur031-paternite.mjs (36/36 OK) ; '
    'retest-jur031-documents.mjs (12/12 OK) ; '
    '_ui-jur031-paternite.mjs (navigateur, 6/6 OK) ; '
    'retest-jur025-037.mjs (69/69 OK) ; '
    '_retest-anomaly-uniqueness.mjs (4/4 OK, unicité SQL stricte) ; '
    '_ui-jur025-037.mjs (navigateur, 11/11 OK) ; '
    '_ui-accrual-anomalies.mjs (navigateur, 8/8 OK) ; '
    '_ui-accrual-anomalies-rh-decision.mjs (navigateur, 5/5 OK, onglet Décidées RH) ; '
    '_retest-l3141-7-isolated.mjs (3/3 OK, arrondi de clôture isolé) ; '
    'unitaires backend : 547 passed / 32 skipped'
)

W = 'w'


def _el(tag):
    return OxmlElement(W + ':' + tag)


def clear_tc(tc):
    for p in tc.findall(qn('w:p')):
        tc.remove(p)


def add_para(tc):
    p = _el('p')
    tc.append(p)
    return p


def get_rpr(tc):
    r = tc.find('.//' + qn('w:r'))
    rpr = r.find(qn('w:rPr')) if r is not None else None
    return deepcopy(rpr) if rpr is not None else None


def make_run(rpr, parts):
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


def set_simple_cell(cell, text):
    paras = cell.paragraphs
    p = paras[0]
    runs = p.runs
    if runs:
        runs[0].text = text
        for r in runs[1:]:
            r._r.getparent().remove(r._r)
    else:
        p.add_run(text)
    for extra in paras[1:]:
        extra._p.getparent().remove(extra._p)


def update_row(row_el, proof, obtained, comment, status='Conforme techniquement — homologation RH en attente'):
    tcs = row_el.findall(qn('w:tc'))
    rpr = get_rpr(tcs[0])
    tc = tcs[6]
    clear_tc(tc)
    p = add_para(tc)
    p.append(make_run(rpr, [('t', proof)]))
    tc = tcs[7]
    clear_tc(tc)
    p = add_para(tc)
    if not obtained.startswith('Résultat obtenu : '):
        obtained = 'Résultat obtenu : ' + obtained
    p.append(make_run(rpr, [('t', obtained)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Statut : ' + status)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Commentaire : ' + comment)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Date de test : ' + DATE)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : ' + TESTEUR)]))


doc = docx.Document(SRC)
scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None

updates = {
    'JUR-029': (
        'Événements familiaux intégrés de bout en bout et corrigés : versions légales de l’annonce handicap '
        '(2 j depuis le 19/12/2021, 5 j depuis le 21/07/2023, 10 j depuis le 14/06/2026), article 5.7 Syntec '
        'complet (mariage d’un enfant 1 j ouvré, décès par lien familial en jours ouvrés), unités réelles, '
        'dépassements refusés, justificatifs contrôlés, absence non débitée des CP.',
        'Syntec applicable par entité et éventuels accords d’entreprise à confirmer par la RH.'
    ),
    'JUR-030': (
        'Congé de deuil (8 j ouvrables, deux périodes max, délai d’un an du décès au jour précédant l’anniversaire, '
        'quota rattaché au même décès) et enfant malade (quota annuel par salarié, jours hors période exclus, '
        'réservations/consommations distinguées, concurrence sérialisée). Demandes incertaines soumises à une '
        'décision RH motivée et tracée.',
        'Syntec applicable par entité et éventuels accords d’entreprise à confirmer par la RH.'
    ),
    'JUR-025': (
        'AT/MP assimilé au travail effectif : 2,5 jours ouvrables/mois, SANS limite d’un an depuis le 24/04/2024 (loi '
        '2024-364). Avant le 24/04/2024 : assimilation dans la limite d’une durée ININTERROMPUE d’un an appréciée par '
        'DATE ANNIVERSAIRE (années bissextiles et 29 février inclus ; déclarations consécutives fusionnées, interruption '
        'réelle réinitialise). Au-delà : journées PROVISOIRES, jamais définitivement privées de droits (Cass. soc. 13/09/2023 '
        'n° 22-17.638) — la protection contre les corrections négatives est LIMITÉE à la part historiquement indéterminée, '
        'les corrections certaines restant appliquées. Chevauchements contradictoires suivis en anomalies persistantes avec '
        'décision RH réellement APPLIQUÉE par le moteur et SCOPÉE au conflit précis (conflict_key) : deux conflits distincts '
        'du même mois restent deux anomalies indépendantes, une décision sur l’un ne résout jamais l’autre ; classification '
        'retenue strictement validée (valeur admise ET présente parmi les absences concernées), statut RH_DECIDED stable au '
        'recalcul, résolution VÉRIFIÉE seulement quand la cause a réellement disparu. Décisions ANTÉRIEURES à la structuration : '
        'LEGACY_PENDING conserve les droits DÉJÀ crédités (aucune régularisation négative automatique) sans attribuer de droit '
        'conventionnel NOUVEAU non vérifié ; vérification RH traçable. Unicité SQL STRICTE des anomalies (index sur colonnes '
        'générées COALESCE(NULL → '') : un salarié/type/période/mois sans conflict_key = une seule anomalie, plusieurs conflict_key '
        'distincts = plusieurs anomalies, mois NULL géré, insertions concurrentes sans doublon). Anciens mouvements sans '
        'accrual_month rattachés/ignorés selon le mois, ambiguïté limitée à SA période. Idempotence transactionnelle (verrou pessimiste).',
        'Traitement transitoire (art. 37 II loi 2024-364, application encadrée depuis le 01/12/2009, plafond 24 j, réserves '
        'juridiques, prescription 2 ans expirée le 24/04/2026) : décision RH requise, aucune régularisation historique globale.'
    ),
    'JUR-037': (
        'Maladie ou accident non professionnel : 2 jours ouvrables/mois (L3141-5-1), plafond de 24 jours ouvrables '
        'STRICTEMENT isolé par salarié et par période de référence, DÉTERMINISTE quelle que soit la séquence. Décision RH '
        'INDIVIDUELLE à fondement STRUCTURÉ et VÉRIFIABLE : nature (Syntec/accord/clause contractuelle/autre), période de '
        'validité datée, document justificatif réellement téléversé/validé rattaché, statut PROPOSED/VALIDATED/LEGACY_PENDING. '
        'Syntec 5.5 refusé hors Syntec ; accord d’entreprise : période de validité ENREGISTRÉE sur l’entité ET adossée à un '
        'justificatif d’accord VÉRIFIÉ (un PATCH de dates seul ne fait pas preuve) ; clause contractuelle/« AUTRE » admis seulement '
        'après TÉLÉVERSEMENT (EN ATTENTE) puis VALIDATION RH JUSTIFIÉE (fichier physique conservé, valideur RH distinct du '
        'téléverseur, périmètre salarié/entité contrôlé — hors périmètre refusé 403, document d’un autre salarié ou invalidé '
        'refusé/réévalué) — jamais une simple justification libre. Seule une décision VALIDATED est créditée (une PROPOSITION n’est '
        'jamais appliquée ; une décision antérieure LEGACY_PENDING conserve les droits acquis sans droit nouveau). '
        'Cohérence avec un arrêt maladie enregistré (création et modification), chevauchements concurrents rejetés (verrou '
        'GET_LOCK, démontré : une 201 + une 409). Arrondi unique sur le total. Ventilation illness_days réalignée.',
        'Règles transitoires et périodes historiques (art. 37 II loi 2024-364) : décision RH requise, aucune régularisation '
        'historique automatique.'
    ),
    'JUR-031': (
        'Congé de paternité et d’accueil de l’enfant intégré de bout en bout : événement de naissance géré par le '
        'backend (identifiant fiable, unicité atomique employee/date, accès par salarié contrôlé, correction RH '
        'justifiée, historisée et revalidée), jours calendaires (week-ends et fériés inclus), première période de 4 '
        'jours consécutifs dont le premier jour suit immédiatement la fin du congé de naissance ENREGISTRÉ '
        '(enchaînement L1225-35 vérifié, congé incomplet ou en attente → régularisation RH), seconde période de '
        '21/28 jours plafonnée indépendamment, fractionnable en deux périodes d’au moins 5 jours, total 25/32, '
        'délai de 6 mois avec exceptions, prévenance d’un mois civil (D1225-8) avec exceptions toujours remontées en '
        'vérification RH, cumul protégé par GET_LOCK, annulation/modification restituant les jours et historisées '
        '(ancien/nouvel état en audit), justificatif réel (PDF) dans le circuit documentaire existant, parcours '
        'collaborateur → RH → décision finale (rattachement fiable exigé avant enregistrement). L’acquisition des '
        'congés payés n’est pas réduite par la paternité (démontré).',
        'Homologation RH à confirmer : fondements juridiques des exceptions de prévenance (vérification RH '
        'systématique, sans autorisation automatique sur simple case cochée).'
    ),
}

JUR031_STATUS = 'Intégré techniquement — homologation RH en attente'
JUR_ACQUISITION_STATUS = 'Partiellement intégré — homologation RH en attente'

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in updates:
        obtained, comment = updates[cid]
        if cid == 'JUR-031':
            status = JUR031_STATUS
        elif cid in ('JUR-025', 'JUR-037'):
            status = JUR_ACQUISITION_STATUS
        else:
            status = 'Conforme techniquement — homologation RH en attente'
        update_row(r._tr, PROOF, obtained, comment, status=status)
        print('scénario mis à jour :', cid)

# T01 — date de test
info = doc.tables[1]
for r in info.rows:
    if r.cells[0].text.strip() == 'Date':
        set_simple_cell(r.cells[1], DATE)

doc.save(DST)
print('DOCX v2.12 mis à jour in place :', DST)
