# -*- coding: utf-8 -*-
"""Mise à jour in place du cahier v2.12 : JUR-029 / JUR-030 conformes
techniquement (intégration backend + formulaires + tests de bout en bout)."""
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.12.docx'
DST = SRC

VERSION = '2.12'
DATE = '30/10/2026'
TESTEUR = 'Pi — test automatisé'

PROOF_JUR2930 = (
    'tests/recette/scripts/retest-jur029-030-e2e.mjs (35/35 OK) ; '
    'tests/recette/scripts/_ui-jur029-030.mjs (navigateur, 5/5 OK) ; '
    'backend/src/leave-balances/family-event-rules.util.spec.ts (19 tests) ; '
    'backend/src/absence-declarations/absence-declarations.service.spec.ts (20 tests)'
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


doc = docx.Document(SRC)

scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None

updates = {
    'JUR-029': (
        'Événements familiaux intégrés de bout en bout (formulaire collaborateur + traitement RH) : règles '
        'versionnées par entité (Syntec 5.7 / Code du travail), unités réelles ouvrés/ouvrables, mariage 4 j, '
        'naissance/adoption 3 j ouvrés, décès d’enfant 12/14 j ouvrés, annonce handicap versionnée (< 21/07/2023 → '
        'vérification RH), dépassements refusés, justificatifs contrôlés, absence non débitée des CP.',
        'Syntec applicable par entité et éventuels accords d’entreprise à confirmer par la RH.'
    ),
    'JUR-030': (
        'Congé de deuil (8 j ouvrables, fractionnable, délai d’un an) et annonce handicap intégrés : quota deuil '
        'cumulé sur un an, quota annuel enfant malade (3/5 j non rémunéré), jours fériés exclus du décompte, '
        'permissions, dates invalides, identifiants salariés, modification, annulation et changement d’entité testés.',
        'Syntec applicable par entité et éventuels accords d’entreprise à confirmer par la RH.'
    ),
}

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in updates:
        obtained, comment = updates[cid]
        update_row(r._tr, PROOF_JUR2930, obtained, comment)
        print('scénario mis à jour :', cid)

# T01 — date de test
info = doc.tables[1]
for r in info.rows:
    k = r.cells[0].text.strip()
    if k == 'Date':
        set_simple_cell(r.cells[1], DATE)

# T02 — historique (nouvelle ligne, sans changer de version)
hist = doc.tables[2]
new = hist.add_row()
vals = [
    VERSION,
    DATE,
    'Pi — test automatisé',
    'JUR-029 / JUR-030 terminés : intégration backend (règles versionnées, quotas, unités réelles, contrôles non '
    'contournables), formulaires collaborateur et RH, tests API 35/35 et navigateur 5/5. Statut : conformes '
    'techniquement — homologation RH en attente.',
    'Campagne juridique : JUR-029 / JUR-030 conformes techniquement.',
]
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

doc.save(DST)
print('DOCX v2.12 mis à jour in place :', DST)
