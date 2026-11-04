# -*- coding: utf-8 -*-
"""Création du cahier v2.5 : JUR-019 / JUR-020 ancienneté Syntec — technique disponible, homologation RH en attente."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.4.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.5.docx'

VERSION = '2.5'
DATE = '29/10/2026'
TESTEUR = 'Pi — test automatisé'

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

PROOF = (
    'tests/recette/scripts/retest-jur019-020-anciennete.mjs (9/9 OK) ; '
    'backend/src/leave-balances/syntec-seniority.util.spec.ts (13 tests) ; '
    'conformite-legale.spec.ts — CONFORMITÉ B (active)'
)

def update_row(row_el, obtained, comment):
    tcs = row_el.findall(qn('w:tc'))
    rpr = get_rpr(tcs[0])

    # cell 6 — Preuve
    tc = tcs[6]
    clear_tc(tc)
    p = add_para(tc)
    p.append(make_run(rpr, [('t', PROOF)]))

    # cell 7 — Résultat / statut / commentaire / date / testeur
    tc = tcs[7]
    clear_tc(tc)
    p = add_para(tc)
    if not obtained.startswith('Résultat obtenu : '):
        obtained = 'Résultat obtenu : ' + obtained
    p.append(make_run(rpr, [('t', obtained)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Statut : Bloqué — homologation RH en attente')]))
    p.append(make_run(rpr, [('br', None), ('t', 'Commentaire : ' + comment)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Date de test : ' + DATE)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : ' + TESTEUR)]))


shutil.copy2(SRC, DST)
doc = docx.Document(DST)

# 1) table module 20
scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None

updates = {
    'JUR-019': (
        'Mécanisme manuel RH validé : attribution des jours d’ancienneté par correction de solde '
        '(CORRECTION_POSITIVE) tracée (mouvement + audit RH_BALANCE_CORRECTED). Utilitaire de référence '
        'testé : paliers 5/10/15/20 ans (totaux non cumulatifs, +1/+2/+3/+4 jours ouvrés). '
        'Aucune attribution automatique.',
        'Applicabilité Syntec à confirmer pour chaque entité (GMES, Efficience, GMES Ingénierie). '
        'Attribution manuelle et tracée (motif « Ancienneté Syntec 5.1 — X ans révolus au 01/05/AAAA »). '
        'Automatisation non nécessaire.'
    ),
    'JUR-020': (
        'Date d’appréciation documentée et testée : ancienneté révolue calculée à la date de référence '
        '(1er mai), frontières 4 ans 364 j vs 5 ans, anniversaire avant/après le 1er mai. '
        'Utilitaire fullYearsBetween/syntecSeniorityExtraDays testé.',
        'La date de référence (1er mai à défaut de stipulation différente) doit être confirmée par la RH. '
        'L’utilitaire fournit la référence testée, sans attribution automatique.'
    ),
}

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in updates:
        obtained, comment = updates[cid]
        update_row(r._tr, obtained, comment)
        print('scénario mis à jour :', cid)

# 2) T01
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
            '14 bloqués (dont JUR-019/JUR-020/JUR-027 recette technique validée en test, homologation RH en attente) '
            '— EN COURS DE VALIDATION.',
        )

# 3) T02 — historique v2.5
hist = doc.tables[2]
new = hist.add_row()
vals = [
    VERSION,
    DATE,
    'Pi — test automatisé',
    'JUR-019 / JUR-020 : ancienneté Syntec 5.1 — attribution manuelle RH tracée validée et utilitaire de référence '
    'testé (paliers 5/10/15/20 ans, date d’appréciation au 1er mai) ; statut « Bloqué — homologation RH en attente ».',
    'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 14 bloqués — EN COURS DE VALIDATION.',
]
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# 4) Paragraphe de décision
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
                'conservée. Campagne juridique (module 20, v2.5 du 29/10/2026) : 37 scénarios ajoutés — 23 conformes '
                '(15 vérifiés par tests unitaires/preuves BAL-009 + 7 scénarios L3141-7 + JUR-026 conformité technique du '
                'mécanisme RH, exécutés par Pi — test automatisé), 14 bloqués (10 fonctionnalités non gérées/applicabilité '
                'Syntec à confirmer + JUR-019/JUR-020 ancienneté Syntec 5.1 technique disponible mais homologation RH en '
                'attente + JUR-027 recette technique validée en test mais homologation RH en attente + JUR-037 conformité '
                'juridique des arrêts maladie en attente de validation RH). La campagne juridique reste EN COURS DE '
                'VALIDATION : aucune décision finale de recette n’est prononcée pour le module 20 tant que les 14 '
                'scénarios bloqués n’ont pas été traités ou arbitrés.'
            )
            rr.append(tt)
            for r in runs[1:]:
                r._r.getparent().remove(r._r)
        break

doc.save(DST)
print('DOCX v2.5 enregistré :', DST)
