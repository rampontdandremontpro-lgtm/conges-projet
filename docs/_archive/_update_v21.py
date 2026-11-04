# -*- coding: utf-8 -*-
"""Création du cahier v2.1 : intégration des 7 scénarios JUR exécutés (L3141-7)."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.0.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.1.docx'

VERSION = '2.1'
DATE = '26/10/2026'
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

def set_result_cell(cell, rpr, obtained, status, comment, dtest, tester):
    clear_tc(cell._tc)
    p = add_para(cell._tc)
    obt = obtained if obtained.startswith('Résultat obtenu : ') else ('Résultat obtenu : ' + obtained)
    p.append(make_run(rpr, [('t', obt)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Statut : ' + status)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Commentaire : ' + comment)]))
    p.append(make_run(rpr, [('br', None)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Date de test : ' + dtest)]))
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : ' + tester)]))

# ---------------------------------------------------------------------------
# Données des 7 scénarios exécutés
# ---------------------------------------------------------------------------
EXEC = {
 'JUR-012': dict(
   proof='tests/recette/reports/retest-arrondi-l3141-7.json (11/11 OK) + retest-arrondi-l3141-7.log',
   status='Conforme',
   obtained='embauche 16/07/2024 → acquiredDays 26,29 ; clôture 2024-2025 HTTP 201 ; supplément d’arrondi +0,71 ; transfert N→N-1 = 27 ; N-1 2025-2026 reçoit 27 jours ; mouvement CLOTURE_ARRONDI_L3141_7 (+0,71) tracé ; idempotence HTTP 409.',
   comment='Exécuté par Pi — test automatisé le 26/10/2026 (environnement isolé : API 3001, base gestion_conges_gmes_test).',
 ),
 'JUR-014': dict(
   proof='tests/recette/reports/retest-arrondi-l3141-7-cas.json (18/18 OK) + retest-arrondi-l3141-7-cas.log',
   status='Conforme',
   obtained='un seul mouvement CLOTURE_ARRONDI_L3141_7 par salarié ; aucune double attribution.',
   comment='Test technique (états consommés/réservés préparés par SQL) ; contrôle de traçabilité via API réelle. Exécuté par Pi — test automatisé le 26/10/2026.',
 ),
 'JUR-015': dict(
   proof='tests/recette/reports/retest-arrondi-l3141-7-cas.json (18/18 OK)',
   status='Conforme',
   obtained='clôture refusée HTTP 400 tant que des jours sont réservés ; aucun supplément d’arrondi pendant le blocage ; clôture acceptée après libération (HTTP 201).',
   comment='Test technique (réservation préparée par SQL) ; clôture via API réelle. Exécuté par Pi — test automatisé le 26/10/2026.',
 ),
 'JUR-016': dict(
   proof='tests/recette/reports/retest-arrondi-l3141-7-cas.json (18/18 OK)',
   status='Conforme',
   obtained='solde N négatif conservé après clôture (availableDays=-3, acquiredDays=27) ; notification RH émise.',
   comment='Test technique (solde négatif préparé par SQL) ; clôture via API réelle. Ne constitue pas une validation complète du circuit métier. Exécuté par Pi — test automatisé le 26/10/2026.',
 ),
 'JUR-017': dict(
   proof='tests/recette/reports/retest-arrondi-l3141-7.json + retest-arrondi-l3141-7-cas.json',
   status='Conforme',
   obtained='seconde clôture refusée HTTP 409 (vérifié sur les périodes 2024-2025 et 2023-2024).',
   comment='Exécuté par Pi — test automatisé le 26/10/2026.',
 ),
 'JUR-018': dict(
   proof='tests/recette/reports/retest-arrondi-l3141-7-cas.json (18/18 OK)',
   status='Conforme',
   obtained='correction +3 → droit 29,29 → 30 après arrondi ; correction -5 → 21,29 → 22 après arrondi.',
   comment='Corrections RH via API réelle (POST /leave-balances/:id/correction). Exécuté par Pi — test automatisé le 26/10/2026.',
 ),
 'JUR-035': dict(
   proof='tests/recette/reports/retest-arrondi-l3141-7.json + retest-arrondi-l3141-7-cas.json',
   status='Conforme',
   obtained='cycle complet vérifié : transferts N→N-1, remises à zéro des soldes positifs, solde négatif conservé, notification de clôture.',
   comment='Test technique (états consommés/réservés préparés par SQL) ; clôture via API réelle. Ne constitue pas une validation complète du circuit métier. Exécuté par Pi — test automatisé le 26/10/2026.',
 ),
}

# ---------------------------------------------------------------------------
shutil.copy2(SRC, DST)
doc = docx.Document(DST)

# 1) Table des scénarios du module 20
scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in EXEC:
        data = EXEC[cid]
        rpr = get_rpr(r.cells[0]._tc)
        set_simple_cell(r.cells[6], data['proof'])
        set_result_cell(r.cells[7], rpr, data['obtained'], data['status'],
                        data['comment'], DATE, TESTEUR)
        print('scénario exécuté :', cid)

# 2) T01 — Informations du document
info = doc.tables[1]
for r in info.rows:
    k = r.cells[0].text.strip()
    if k == 'Version':
        set_simple_cell(r.cells[1], VERSION)
    elif k == 'Date':
        set_simple_cell(r.cells[1], DATE)
    elif k == 'Statut du document':
        set_simple_cell(r.cells[1],
                        'Recette historique acceptée (420/420) — campagne juridique (module 20) : 7 scénarios exécutés conformes, 14 bloqués — EN COURS DE VALIDATION.')

# 3) T02 — Historique des versions : ajouter v2.1
hist = doc.tables[2]
new = hist.add_row()
vals = [VERSION, DATE, 'Pi — test automatisé',
        'Exécution des 7 scénarios JUR restants (arrondi L3141-7 et clôture) : 11/11 et 18/18 contrôles OK ; statuts « À tester » passés à « Conforme » ; synthèse actualisée.',
        'Recette historique acceptée (420/420) ; campagne juridique : 442 conformes, 14 bloqués — EN COURS DE VALIDATION.']
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# 4) T28 — Synthèse et décision
dec = doc.tables[30]
for r in dec.rows:
    k = r.cells[0].text.strip()
    if k == 'Scénarios conformes':
        set_simple_cell(r.cells[1], '442')
    elif k == 'Scénarios restant à tester':
        set_simple_cell(r.cells[1], '0')
    elif k.startswith('Taux de réussite'):
        set_simple_cell(r.cells[1], '100 % (442 conformes / 442 scénarios exécutés)')
    elif k == 'Avancement global de la recette':
        set_simple_cell(r.cells[1], '96,9 % (442 conformes / 456 scénarios ; 14 non exécutés : 14 bloqués)')

# 5) Décision — texte
for p in doc.paragraphs:
    t = p.text
    if t.strip().startswith('Recette historique (v1.9)'):
        runs = p.runs
        if runs:
            from docx.oxml import OxmlElement as _OE
            r0 = runs[0]
            rr = r0._r
            for child in list(rr):
                if child.tag in (qn('w:t'), qn('w:br'), qn('w:tab')):
                    rr.remove(child)
            tt = _el('t')
            tt.set(qn('xml:space'), 'preserve')
            tt.text = (
                'Recette historique (v1.9) exécutée du 22/09/2026 au 12/10/2026 : LOT 1 à LOT 6, évolution fonctionnelle RH-only et BAL-009 validés, 420/420 scénarios conformes, aucune anomalie ouverte — validation historique conservée. '
                'Campagne juridique (module 20, v2.1 du 26/10/2026) : 36 scénarios ajoutés — 22 conformes (15 vérifiés par tests unitaires/preuves BAL-009 + 7 exécutés par Pi — test automatisé le 26/10/2026), 14 bloqués (fonctionnalités non gérées et/ou applicabilité Syntec à confirmer). '
                'La campagne juridique reste EN COURS DE VALIDATION : aucune décision finale de recette n’est prononcée pour le module 20 tant que les 14 scénarios bloqués n’ont pas été traités ou arbitrés.')
            rr.append(tt)
            for r in runs[1:]:
                r._r.getparent().remove(r._r)

doc.save(DST)
print('DOCX v2.1 enregistré :', DST)
