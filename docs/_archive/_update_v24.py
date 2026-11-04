# -*- coding: utf-8 -*-
"""Création du cahier v2.4 : JUR-027 recette technique validée, statut « Bloqué — homologation RH en attente »."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.3.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.4.docx'

VERSION = '2.4'
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

def update_jur027_cells(row_el, tester):
    tcs = row_el.findall(qn('w:tc'))
    rpr = get_rpr(tcs[0])

    # Cellule 6 — Preuve
    proof = (
        'tests/recette/reports/retest-l7-complement.json (10/11 OK + 1 KO attendu G5-B) ; '
        'retest-e3b-real-flow.json (4/4) ; retest-e3b-corrections.json (3/3) ; '
        'retest-e3b-matrix.json (9/9) ; retest-e3b-concurrency.json (2/2) ; '
        'retest-l6-final.json (18/18 ×3) ; tests unitaires 448 ; e2e 37/37 — '
        'détail : docs/RAPPORT_INTEGRATION_FINALE_JUR027.md'
    )
    tc = tcs[6]
    clear_tc(tc)
    p = add_para(tc)
    p.append(make_run(rpr, [('t', proof)]))

    # Cellule 7 — Résultat / statut / commentaire / date / testeur
    obtained = (
        'Fonctionnalité développée et validée techniquement en environnement de test '
        '(report maladie + raccordement au système de congés, gated par '
        'CARRYOVER_LOTS_REAL_FLOW_ENABLED désactivé par défaut). Retests techniques '
        'réussis : circuits C1-C4, demandes Directeur, demi-journées, annulations '
        '(y compris lots expirés), rejeu scheduler, concurrence, L6 stable (18/18 ×3).'
    )
    status = 'Bloqué — homologation RH en attente'
    comment = (
        'Trois règles métier provisoires en attente de confirmation RH : '
        'D1 — lots maladie éligibles par expiration croissante puis congés ordinaires N-1/N ; '
        'D2 — débit définitif à la prise effective, engagements prévisionnels pris en compte '
        'sans nouvelle réservation comptable ; '
        'D3 — annulation après expiration en régularisation traçable sans recrédit automatique. '
        'Réf. : L3141-19-1 à -3 ; Syntec IDCC 1486 art. 5.3 et 5.5 ; Cass. soc. 13/11/2025 n° 24-14.084. '
        'Voir docs/RAPPORT_INTEGRATION_FINALE_JUR027.md. Validation technique uniquement, '
        'pas d’homologation métier.'
    )
    dtest = DATE

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
    p.append(make_run(rpr, [('br', None), ('t', 'Date de test : ' + dtest)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : ' + tester)]))


shutil.copy2(SRC, DST)
doc = docx.Document(DST)

# 1) Table du module 20 — mise à jour JUR-027
scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None, 'table scénarios introuvable'

found = False
for r in scen_table.rows[1:]:
    if r.cells[0].text.strip() == 'JUR-027':
        update_jur027_cells(r._tr, TESTEUR)
        found = True
        print('scénario mis à jour : JUR-027 (recette technique validée, homologation RH en attente)')
        break
assert found, 'JUR-027 introuvable'

# 2) T01 — informations
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
            '14 bloqués (dont JUR-027 recette technique validée en test, homologation RH en attente) — EN COURS DE VALIDATION.',
        )

# 3) T02 — historique v2.4
hist = doc.tables[2]
new = hist.add_row()
vals = [
    VERSION,
    DATE,
    'Pi — test automatisé',
    'JUR-027 : fonctionnalité de report maladie développée et recette technique validée en environnement de test ; '
    'statut « Bloqué — homologation RH en attente » ; trois règles métier provisoires D1/D2/D3 enregistrées '
    '(voir docs/RAPPORT_INTEGRATION_FINALE_JUR027.md).',
    'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 14 bloqués — EN COURS DE VALIDATION.',
]
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# 4) Paragraphe de décision — mise à jour narrative
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
                'conservée. Campagne juridique (module 20, v2.4 du 29/10/2026) : 37 scénarios ajoutés — 23 conformes '
                '(15 vérifiés par tests unitaires/preuves BAL-009 + 7 scénarios L3141-7 + JUR-026 conformité technique du '
                'mécanisme RH, exécutés par Pi — test automatisé), 14 bloqués (12 fonctionnalités non gérées/applicabilité '
                'Syntec à confirmer + JUR-027 recette technique validée en test mais homologation RH en attente + JUR-037 '
                'conformité juridique des arrêts maladie en attente de validation RH). La campagne juridique reste '
                'EN COURS DE VALIDATION : aucune décision finale de recette n’est prononcée pour le module 20 tant que '
                'les 14 scénarios bloqués n’ont pas été traités ou arbitrés.'
            )
            rr.append(tt)
            for r in runs[1:]:
                r._r.getparent().remove(r._r)
        break

doc.save(DST)
print('DOCX v2.4 enregistré :', DST)
