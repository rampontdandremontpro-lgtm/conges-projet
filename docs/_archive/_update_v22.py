# -*- coding: utf-8 -*-
"""Création du cahier v2.2 : rectification JUR-026 (processus manuel RH)."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.1.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.2.docx'

VERSION = '2.2'
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

def fill_row(row_el, scen, tester):
    tcs = row_el.findall(qn('w:tc'))
    rpr = get_rpr(tcs[0])
    simple = {0: scen['id'], 1: scen['prio'], 2: scen['scen'],
              3: scen['role'], 5: scen['expected'], 6: scen['proof']}
    for idx, val in simple.items():
        tc = tcs[idx]
        clear_tc(tc)
        p = add_para(tc)
        p.append(make_run(rpr, [('t', val)]))
    tc = tcs[4]
    clear_tc(tc)
    p0 = add_para(tc)
    p0.append(make_run(rpr, [('t', 'Préconditions : ' + scen['precond'])]))
    p1 = add_para(tc)
    p1.append(make_run(rpr, [('br', None), ('t', 'Étapes :')]))
    for step in scen['steps']:
        p1.append(make_run(rpr, [('br', None), ('t', step)]))
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
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : ' + tester)]))

JUR026 = dict(
  id='JUR-026',
  prio='P1',
  scen='Acquisition pendant une maladie non professionnelle : ajustement manuel RH (2 jours/mois, plafond 24 jours) — Réf. L3141-5-1',
  role='RH',
  precond='Collaborateur en arrêt maladie non professionnelle ; acquisition mensuelle automatique de 2,5 jours ouvrables configurée ; base gestion_conges_gmes_test.',
  steps=[
    'Exécuter l’acquisition mensuelle (POST /leave-balances/accrual/run) : crédit automatique de 2,5 jours ouvrables.',
    'La RH examine le nombre de jours d’arrêt et applique une correction manuelle (POST /leave-balances/:id/correction, motif obligatoire) pour ajuster le droit acquis (ex. -0,5 jour pour un mois complet d’arrêt → 2 jours/mois).',
    'Vérifier le droit acquis, le solde disponible et l’historisation (mouvement + audit).',
  ],
  expected='L’acquisition automatique crédite 2,5 jours/mois ; la RH ajuste manuellement le droit acquis selon les jours d’arrêt (2 jours/mois, plafond 24 jours pour maladie non professionnelle, ou disposition plus favorable). La correction ajuste acquiredDays/availableDays et est historisée (motif, auteur, montant, balance avant/après). Aucun calcul automatique de réduction n’est appliqué.',
  proof='tests/recette/reports/retest-jur026-maladie-correction.json (12/12 OK) + retest-jur026-maladie-correction.log',
  status='Conforme',
  obtained='mois complet d’arrêt : crédit automatique 2,5 j → correction RH -0,5 → 2,0 j ; mouvement CORRECTION_NEGATIVE (days=0,5, actorId RH, motif L3141-5-1) + audit RH_BALANCE_CORRECTED.',
  comment='Processus manuel RH (distinct des calculs automatiques). Le plafond annuel de 24 jours et les dispositions plus favorables relèvent de l’appréciation RH ; aucun calcul automatique de réduction à développer sans autorisation.',
  dtest=DATE,
)

shutil.copy2(SRC, DST)
doc = docx.Document(DST)

# 1) JUR-026 dans la table du module 20
scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None
for r in scen_table.rows[1:]:
    if r.cells[0].text.strip() == 'JUR-026':
        fill_row(r._tr, JUR026, TESTEUR)
        print('scénario rectifié : JUR-026')
        break

# 2) T01
info = doc.tables[1]
for r in info.rows:
    k = r.cells[0].text.strip()
    if k == 'Version':
        set_simple_cell(r.cells[1], VERSION)
    elif k == 'Date':
        set_simple_cell(r.cells[1], DATE)
    elif k == 'Statut du document':
        set_simple_cell(r.cells[1],
                        'Recette historique acceptée (420/420) — campagne juridique (module 20) : 23 scénarios conformes, 13 bloqués — EN COURS DE VALIDATION.')

# 3) T02 — historique v2.2
hist = doc.tables[2]
new = hist.add_row()
vals = [VERSION, DATE, 'Pi — test automatisé',
        'Rectification JUR-026 : arrêt maladie non professionnelle traité par processus manuel RH (acquisition automatique 2,5 j/mois + correction manuelle historisée) ; statut passé à « Conforme » (12/12 OK).',
        'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 13 bloqués — EN COURS DE VALIDATION.']
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# 4) T28
dec = doc.tables[30]
for r in dec.rows:
    k = r.cells[0].text.strip()
    if k == 'Scénarios conformes':
        set_simple_cell(r.cells[1], '443')
    elif k == 'Scénarios bloqués':
        set_simple_cell(r.cells[1], '13')
    elif k.startswith('Taux de réussite'):
        set_simple_cell(r.cells[1], '100 % (443 conformes / 443 scénarios exécutés)')
    elif k == 'Avancement global de la recette':
        set_simple_cell(r.cells[1], '97,1 % (443 conformes / 456 scénarios ; 13 non exécutés : 13 bloqués)')

# 5) Décision
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
                'Recette historique (v1.9) exécutée du 22/09/2026 au 12/10/2026 : LOT 1 à LOT 6, évolution fonctionnelle RH-only et BAL-009 validés, 420/420 scénarios conformes, aucune anomalie ouverte — validation historique conservée. '
                'Campagne juridique (module 20, v2.2 du 26/10/2026) : 36 scénarios ajoutés — 23 conformes (15 vérifiés par tests unitaires/preuves BAL-009 + 7 scénarios L3141-7 + JUR-026 processus manuel RH, exécutés par Pi — test automatisé), 13 bloqués (fonctionnalités non gérées et/ou applicabilité Syntec à confirmer). '
                'La campagne juridique reste EN COURS DE VALIDATION : aucune décision finale de recette n’est prononcée pour le module 20 tant que les 13 scénarios bloqués n’ont pas été traités ou arbitrés.')
            rr.append(tt)
            for r in runs[1:]:
                r._r.getparent().remove(r._r)

doc.save(DST)
print('DOCX v2.2 enregistré :', DST)
