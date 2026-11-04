# -*- coding: utf-8 -*-
"""Création du cahier v2.8 : consolidation JUR-019→022 (5e semaine fiable, unités,
annulations/concurrence, migration sécurisée, recette navigateur). Statut inchangé."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.7.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.8.docx'

VERSION = '2.8'
DATE = '29/10/2026'
TESTEUR = 'Pi — test automatisé'
PROOF = (
    'tests/recette/scripts/retest-jur019-022-integration.mjs (15/15 OK) ; '
    'retest-jur019-022-consolidation.mjs (10/10 OK) ; _ui-extra-days.mjs (navigateur, 8/8 OK) ; '
    'fractionnement.util.spec.ts (11 tests) ; syntec-seniority.util.spec.ts (13 tests)'
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


def update_row(row_el, obtained, comment):
    tcs = row_el.findall(qn('w:tc'))
    rpr = get_rpr(tcs[0])
    tc = tcs[6]
    clear_tc(tc)
    p = add_para(tc)
    p.append(make_run(rpr, [('t', PROOF)]))
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
    'JUR-019': (
        'Attribution automatique opérationnelle et idempotente (mouvement SENIORITY_EXTRA + audit) : '
        'paliers 5/10/15/20 ans → +1/+2/+3/+4 jours ouvrés (totaux, non cumulatifs), appréciée à la date de '
        'référence configurable. Conditionnée à la configuration RH par entité. Concurrence, cohérence des unités '
        '(consommation 1:1) et idempotence vérifiées.',
        'Applicabilité Syntec à confirmer pour chaque entité. Configuration paramétrable. Les jours d’ancienneté '
        'sont ajoutés au compteur ordinaire (1 jour ouvré = 1 jour de congé consommé 1:1, sans conversion).'
    ),
    'JUR-020': (
        'Ancienneté calculée à la date de référence configurable (1er mai par défaut) : années révolues, frontières '
        '4 ans 364 j vs 5 ans, anniversaire avant/après le 1er mai.',
        'La date de référence par défaut (1er mai) doit être confirmée par la RH ; paramétrable sans code.'
    ),
    'JUR-021': (
        'Calcul automatique sur les congés réellement pris hors période (jours ouvrés lundi→vendredi, fériés et '
        'demi-journées gérés) : 3-4 jours → +1, ≥5 jours → +2. Cinquième semaine identifiée de façon fiable par un '
        'marqueur explicite (is_fifth_week) : elle est exclue du calcul. Attribution idempotente, recalcul '
        'transactionnel après annulation, concurrence et changement de configuration vérifiés.',
        'Régime Syntec configurable par entité. Conditions de fractionnement et renonciation individuelle écrite '
        'à confirmer par la RH. La 5e semaine (marquée) est exclue ; le plafond de 20 jours ouvrés reste un filet de sécurité.'
    ),
    'JUR-022': (
        'Régime supplétif L3141-23 (jours ouvrables lundi→samedi) : 3-5 jours hors période → +1, ≥6 jours → +2. '
        'Cinquième semaine identifiée par marqueur explicite et exclue. Régime configurable par entité, sans cumul '
        'avec Syntec. Attribution idempotente et recalcul après annulation.',
        'Régime supplétif (à défaut de disposition plus favorable) ; à confirmer avec la RH. Les deux régimes ne '
        'sont jamais cumulés. Le plafond de 24 jours ouvrables reste un filet de sécurité.'
    ),
}

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in updates:
        obtained, comment = updates[cid]
        update_row(r._tr, obtained, comment)
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
            '4 conformes techniquement (homologation RH en attente : JUR-019/020/021/022/027), 10 bloqués — '
            'EN COURS DE VALIDATION.',
        )

# T02 — historique v2.8
hist = doc.tables[2]
new = hist.add_row()
vals = [
    VERSION, DATE, 'Pi — test automatisé',
    'Consolidation JUR-019/020/021/022 : 5e semaine identifiée par marqueur explicite (is_fifth_week), recalcul '
    'transactionnel concurrentiel, garde-fou migrations (aucune migration automatique hors base de test), '
    'cohérence des unités et recette navigateur (8/8) vérifiées. Statut inchangé.',
    'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 4 conformes techniquement, '
    '10 bloqués — EN COURS DE VALIDATION.',
]
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

doc.save(DST)
print('DOCX v2.8 enregistré :', DST)
