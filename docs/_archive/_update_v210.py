# -*- coding: utf-8 -*-
"""Création du cahier v2.10 : correction du rattachement des périodes JUR-023,
parcours de report RH, exclusion des demandes mixtes N/N-1 (aucun jour fractionnaire)."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.9.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.10.docx'

VERSION = '2.10'
DATE = '29/10/2026'
TESTEUR = 'Pi — test automatisé'
PROOF_JUR = (
    'tests/recette/scripts/retest-jur019-022-integration.mjs (15/15 OK) ; '
    'retest-jur019-022-consolidation.mjs (10/10 OK) ; '
    'retest-jur019-022-classification.mjs (6/6 OK) ; _ui-extra-days.mjs (navigateur, 8/8 OK) ; '
    'fractionnement.util.spec.ts (11 tests) ; syntec-seniority.util.spec.ts (13 tests) ; '
    'schema-compatibility.spec.ts (3 tests)'
)
PROOF_JUR023 = (
    'tests/recette/scripts/retest-jur023-reports.mjs (11/11 OK) ; retest-jur023-prise.mjs (5/5 OK) ; '
    'backend/src/leave-balances/take-period.util.spec.ts (6 tests)'
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


def update_row(row_el, proof, obtained, comment):
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
    p.append(make_run(rpr, [('br', None), ('t', 'Statut : Conforme techniquement — homologation RH en attente')]))
    p.append(make_run(rpr, [('br', None), ('t', 'Commentaire : ' + comment)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Date de test : ' + DATE)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : ' + TESTEUR)]))


shutil.copy2(SRC, DST)
doc = docx.Document(DST)

scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None

updates = {
    'JUR-021': (
        'Calcul automatique sur les congés réellement pris hors période (jours ouvrés lundi→vendredi, fériés et '
        'demi-journées gérés). Classification fiable (UNDETERMINED/MAIN/FIFTH_WEEK) ; reclassification RH tracée. '
        'Période d’origine déterministe : demande entièrement N → comptée ; demande mixte N-1/N → exclue du calcul '
        'automatique et signalée pour vérification RH (aucun jour fractionnaire, aucune conversion).',
        'Régime Syntec configurable par entité. Conditions de fractionnement et renonciation individuelle écrite à '
        'confirmer par la RH. 5e semaine (marquée) exclue ; plafond 20 jours ouvrés en filet de sécurité.'
    ),
    'JUR-022': (
        'Régime supplétif L3141-23 (jours ouvrables lundi→samedi) : 3-5 jours hors période → +1, ≥6 jours → +2. '
        'Classification fiable et attribution déterministe identiques à JUR-021 (demande mixte N-1/N exclue et '
        'signalée). Régime configurable par entité, sans cumul avec Syntec.',
        'Régime supplétif (à défaut de disposition plus favorable) ; à confirmer avec la RH. Plafond 24 jours '
        'ouvrables en filet de sécurité.'
    ),
    'JUR-023': (
        'Fenêtre de prise calculée et paramétrable, rattachée à l’ANNÉE DE FIN de la période : pour 2025-2026 → '
        '01/05/2026 → 31/05/2027 ; pour 2026-2027 → 01/05/2027 → 31/05/2028. Statut aux dates limites. Soldes N non '
        'pris listés et non supprimés. Parcours de report RH : demande écrite tracée (auteur, justification, '
        'nouvelle échéance, type ordinaire/maladie distinct), double report refusé.',
        'Dates exactes (1er mai, 13 mois) et procédure de report au-delà sur demande écrite à confirmer par la RH ; '
        'fenêtre et seuil d’alerte paramétrables.'
    ),
}

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in updates:
        obtained, comment = updates[cid]
        proof = PROOF_JUR023 if cid == 'JUR-023' else PROOF_JUR
        update_row(r._tr, proof, obtained, comment)
        print('scénario mis à jour :', cid)

# T01
info = doc.tables[1]
for r in info.rows:
    k = r.cells[0].text.strip()
    if k == 'Version':
        set_simple_cell(r.cells[1], VERSION)
    elif k == 'Date':
        set_simple_cell(r.cells[1], DATE)
    elif k == 'Statut du document':
        set_simple_cell(
            r.cells[1],
            'Recette historique acceptée (420/420) — campagne juridique (module 20) : 23 scénarios conformes, '
            '5 conformes techniquement (homologation RH en attente : JUR-019/020/021/022/023/027), 9 bloqués — '
            'EN COURS DE VALIDATION.',
        )

# T02 — historique v2.10
hist = doc.tables[2]
new = hist.add_row()
vals = [
    VERSION, DATE, 'Pi — test automatisé',
    'Correction JUR-023 : rattachement de la période de prise à l’année de fin (01/05/(AAAA+1) → 31/05/(AAAA+2)) ; '
    'parcours de report RH tracé (demande écrite, double report refusé). JUR-021/022 : demande mixte N-1/N exclue '
    'du calcul automatique (aucun jour fractionnaire).',
    'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 5 conformes techniquement, '
    '9 bloqués — EN COURS DE VALIDATION.',
]
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

doc.save(DST)
print('DOCX v2.10 enregistré :', DST)
