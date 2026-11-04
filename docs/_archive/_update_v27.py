# -*- coding: utf-8 -*-
"""Création du cahier v2.7 : JUR-019/020/021/022 = fonctionnalités opérationnelles
(conformes techniquement, homologation RH en attente)."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.6.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.7.docx'

VERSION = '2.7'
DATE = '29/10/2026'
TESTEUR = 'Pi — test automatisé'
PROOF = 'tests/recette/scripts/retest-jur019-022-integration.mjs (15/15 OK) ; backend/src/leave-balances/fractionnement.util.spec.ts (11 tests) ; backend/src/leave-balances/syntec-seniority.util.spec.ts (13 tests)'

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
    'JUR-019': (
        'Attribution automatique opérationnelle et idempotente (mouvement SENIORITY_EXTRA + audit) : '
        'paliers 5/10/15/20 ans → +1/+2/+3/+4 jours ouvrés (totaux, non cumulatifs). Conditionnée à la '
        'configuration RH par entité : aucune attribution pour une entité non concernée. Concurrence vérifiée.',
        'Applicabilité Syntec à confirmer pour chaque entité. Configuration paramétrable (seuils, date de '
        'référence, entités) via POST/PUT /leave-balances/seniority-extra/*.'
    ),
    'JUR-020': (
        'Ancienneté calculée à la date de référence configurable (1er mai par défaut, SENIORITY_EXTRA_DAYS_CONFIG.'
        'referenceMonthDay) : années révolues, frontières 4 ans 364 j vs 5 ans, anniversaire avant/après le 1er mai.',
        'La date de référence par défaut (1er mai) doit être confirmée par la RH ; elle est paramétrable sans '
        'modification de code.'
    ),
    'JUR-021': (
        'Calcul automatique sur les congés réellement pris hors période (jours ouvrés lundi→vendredi, fériés et '
        'demi-journées gérés, 5e semaine exclue) : 3-4 jours → +1, ≥5 jours → +2. Attribution idempotente '
        '(mouvement FRACTIONNEMENT + audit) et recalcul automatique après annulation (ajustement tracé).',
        'Régime Syntec configurable par entité. Conditions de fractionnement et renonciation individuelle écrite '
        'à confirmer par la RH. La 5e semaine (au-delà de 20 jours ouvrés) est exclue du calcul.'
    ),
    'JUR-022': (
        'Régime supplétif L3141-23 (jours ouvrables lundi→samedi) : 3-5 jours hors période → +1, ≥6 jours → +2 ; '
        'jours au-delà de 24 jours ouvrables (5e semaine) exclus. Régime configurable par entité, sans cumul avec '
        'Syntec. Attribution idempotente et recalcul après annulation.',
        'Régime supplétif (à défaut de disposition plus favorable) ; à confirmer avec la RH. Les deux régimes '
        '(Syntec ouvrés / légal ouvrables) ne sont jamais cumulés.'
    ),
}

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in updates:
        obtained, comment = updates[cid]
        update_row(r._tr, PROOF, obtained, comment)
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

# T02 — historique v2.7
hist = doc.tables[2]
new = hist.add_row()
vals = [
    VERSION, DATE, 'Pi — test automatisé',
    'JUR-019/020 (ancienneté Syntec) et JUR-021/022 (fractionnement Syntec + L3141-23) : fonctionnalités '
    'opérationnelles (attribution automatique idempotente, calcul sur congés réellement pris, recalcul après '
    'annulation, traçabilité) — statut « Conforme techniquement — homologation RH en attente ».',
    'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 4 conformes techniquement, '
    '10 bloqués — EN COURS DE VALIDATION.',
]
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# Table des totaux (table 30) : 4 techniquement conformes, 10 bloqués.
tot = doc.tables[30]
# Insère une ligne « techniquement conformes » après « Scénarios conformes ».
row = tot.add_row()
set_simple_cell(row.cells[0], 'Scénarios techniquement conformes (homologation RH en attente)')
set_simple_cell(row.cells[1], '4')
tr = row._tr
tot._tbl.remove(tr)
tot.rows[2]._tr.addprevious(tr)

for r in tot.rows:
    label = r.cells[0].text.strip()
    if label == 'Scénarios bloqués':
        set_simple_cell(r.cells[1], '10')
    elif label.startswith('Avancement global'):
        set_simple_cell(
            r.cells[1],
            '97,8 % (447 scénarios traités / 457 : 443 conformes + 4 techniquement conformes ; 10 bloqués)',
        )
    elif label.startswith('Taux de réussite'):
        set_simple_cell(r.cells[1], '100 % (443 conformes / 443 scénarios exécutés)')

# Paragraphe de décision
for p in doc.paragraphs:
    t = p.text
    if t.strip().startswith('Recette historique (v1.9)'):
        runs = p.runs
        if runs:
            r0 = runs[0]
            rr = r0._r
            for child in list(rr):
                if child.tag in (qn('w:t'), qn('w:br'), qn('w:tab')):
                    rr.remove(child)
            tt = _el('t')
            tt.set(qn('xml:space'), 'preserve')
            tt.text = (
                'Recette historique (v1.9) exécutée du 22/09/2026 au 12/10/2026 : LOT 1 à LOT 6, évolution fonctionnelle '
                'RH-only et BAL-009 validés, 420/420 scénarios conformes, aucune anomalie ouverte — validation historique '
                'conservée. Campagne juridique (module 20, v2.7 du 29/10/2026) : 37 scénarios ajoutés — 23 conformes '
                '(15 vérifiés par tests unitaires/preuves BAL-009 + 7 scénarios L3141-7 + JUR-026 conformité technique du '
                'mécanisme RH), 4 conformes techniquement avec homologation RH en attente (JUR-019/020 ancienneté Syntec et '
                'JUR-021/022 fractionnement Syntec + L3141-23 : attribution automatique idempotente, calcul sur congés '
                'réellement pris, recalcul après annulation, traçabilité), 10 bloqués (8 fonctionnalités non gérées/'
                'applicabilité Syntec à confirmer + JUR-027 recette technique validée en test mais homologation RH en '
                'attente + JUR-037 conformité juridique des arrêts maladie en attente de validation RH). La campagne '
                'juridique reste EN COURS DE VALIDATION : aucune décision finale de recette n’est prononcée pour le '
                'module 20 tant que les scénarios en attente d’homologation RH n’ont pas été arbitrés.'
            )
            rr.append(tt)
            for r in runs[1:]:
                r._r.getparent().remove(r._r)
        break

doc.save(DST)
print('DOCX v2.7 enregistré :', DST)
