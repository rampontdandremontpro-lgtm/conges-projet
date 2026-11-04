# -*- coding: utf-8 -*-
"""Création du cahier v2.3 : JUR-026 (technique) + JUR-037 (juridique, bloqué)."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.2.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.3.docx'

VERSION = '2.3'
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
  scen='Arrêt maladie non professionnelle : mécanisme de correction manuelle RH des compteurs — Réf. technique (mécanisme, pas une règle juridique)',
  role='RH',
  precond='Collaborateur en arrêt maladie non professionnelle ; acquisition mensuelle automatique de 2,5 jours ouvrables configurée ; base gestion_conges_gmes_test.',
  steps=[
    'Exécuter l’acquisition mensuelle (POST /leave-balances/accrual/run) : crédit automatique de 2,5 jours ouvrables.',
    'La RH examine individuellement la situation et applique, si nécessaire, une correction manuelle positive ou négative (POST /leave-balances/:id/correction, motif obligatoire).',
    'Vérifier la mise à jour des compteurs et l’historisation (motif, auteur, montant, balance avant/après).',
  ],
  expected='Le mécanisme de correction RH fonctionne : acquisition automatique de 2,5 j/mois ; correction manuelle positive ou négative possible ; mise à jour de acquiredDays/availableDays ; historisation (mouvement CORRECTION_NEGATIVE/POSITIVE + audit RH_BALANCE_CORRECTED). Aucune formule de correction automatique n’existe et ne doit pas être ajoutée. La valeur -0,5 jour n’est qu’une démonstration technique, pas une règle générale.',
  proof='tests/recette/reports/retest-jur026-maladie-correction.json (12/12 OK) + retest-jur026-maladie-correction.log',
  status='Conforme',
  obtained='crédit automatique 2,5 j ; correction RH -0,5 (démonstration technique) → 2,0 j ; mouvement CORRECTION_NEGATIVE (days=0,5, actorId RH, motif) + audit RH_BALANCE_CORRECTED.',
  comment='Conformité TECHNIQUE du mécanisme RH uniquement. La conformité juridique des droits pendant arrêt maladie est traitée par JUR-037 (Bloqué). L’exemple -0,5 jour est une simple démonstration technique.',
  dtest=DATE,
)

JUR037 = dict(
  id='JUR-037',
  prio='P1',
  scen='Conformité juridique des droits acquis pendant un arrêt maladie — Réf. Code du travail (L3141-5, L3141-5-1) + Syntec 5.5 (maintien de salaire)',
  role='RH / Juridique',
  precond='Collaborateur en arrêt maladie (non professionnelle) ou accident donnant lieu à maintien de salaire ; convention Syntec applicable le cas échéant ; textes vérifiés sur Légifrance.',
  steps=[
    'Identifier la nature de l’arrêt (maladie non professionnelle, AT/MP) et le maintien de salaire éventuel.',
    'Vérifier les périodes assimilées à du temps de travail effectif : Code du travail (L3141-5, L3141-5-1) et Syntec 5.5 (arrêts maladie/accident avec maintien de salaire par l’employeur selon la convention).',
    'La RH examine individuellement la situation et valide les droits acquis (taux, plafond, dispositions plus favorables).',
  ],
  expected='Les périodes d’arrêt maladie/accident donnant lieu à maintien de salaire selon Syntec 5.5 (lorsque la convention est applicable) sont assimilées à du temps de travail effectif pour le calcul des congés payés ; la maladie non professionnelle suit L3141-5-1 (2 j/mois, plafond 24 j) sauf disposition plus favorable ; l’AT/MP suit L3141-5 (sans limite d’un an). La validation des droits relève de l’examen individuel de la RH.',
  proof='Légifrance — Syntec 5.5 (KALISCTA000047504922) + conformite-legale.spec.ts (L3141-5, L3141-5-1)',
  status='Bloqué',
  obtained='Non exécuté : contrôle juridique nécessitant la validation RH (applicabilité Syntec, maintien de salaire, taux et plafond).',
  comment='En attente de validation RH. L’application ne calcule pas automatiquement les droits pendant arrêt maladie : la RH ajuste manuellement (cf. JUR-026). Syntec 5.5 : les arrêts maladie/accident avec maintien de salaire par l’employeur sont assimilés à du temps de travail effectif (KALISCTA000047504922).',
  dtest='',
)

shutil.copy2(SRC, DST)
doc = docx.Document(DST)

# 1) Table du module 20
scen_table = None
for t in doc.tables:
    if t.rows and any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
        scen_table = t
        break
assert scen_table is not None

# 1a) refonte JUR-026
for r in scen_table.rows[1:]:
    if r.cells[0].text.strip() == 'JUR-026':
        fill_row(r._tr, JUR026, TESTEUR)
        print('scénario rectifié : JUR-026 (technique)')
        break

# 1b) ajout JUR-037
row = scen_table.add_row()
fill_row(row._tr, JUR037, '')
print('scénario ajouté : JUR-037 (juridique, bloqué)')

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
                        'Recette historique acceptée (420/420) — campagne juridique (module 20) : 23 scénarios conformes, 14 bloqués — EN COURS DE VALIDATION.')

# 3) T02 — historique v2.3
hist = doc.tables[2]
new = hist.add_row()
vals = [VERSION, DATE, 'Pi — test automatisé',
        'JUR-026 recentré sur la conformité technique du mécanisme RH ; ajout de JUR-037 (conformité juridique des droits pendant arrêt maladie, Syntec 5.5) — Bloqué en attente de validation RH.',
        'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 14 bloqués — EN COURS DE VALIDATION.']
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# 4) T06 — synthèse des scénarios (module 20 + TOTAL)
syn = doc.tables[6]
for r in syn.rows:
    c0 = r.cells[0].text.strip()
    if c0.startswith('20. Conformité juridique'):
        set_simple_cell(r.cells[1], '18')
        set_simple_cell(r.cells[2], '19')
        set_simple_cell(r.cells[3], '37')
    elif c0 == 'TOTAL':
        set_simple_cell(r.cells[1], '277')
        set_simple_cell(r.cells[2], '180')
        set_simple_cell(r.cells[3], '457')

# 5) T28 — synthèse et décision
dec = doc.tables[30]
for r in dec.rows:
    k = r.cells[0].text.strip()
    if k == 'Nombre total de scénarios':
        set_simple_cell(r.cells[1], '457')
    elif k == 'Scénarios bloqués':
        set_simple_cell(r.cells[1], '14')
    elif k.startswith('Taux de réussite'):
        set_simple_cell(r.cells[1], '100 % (443 conformes / 443 scénarios exécutés)')
    elif k == 'Avancement global de la recette':
        set_simple_cell(r.cells[1], '96,9 % (443 conformes / 457 scénarios ; 14 non exécutés : 14 bloqués)')

# 6) Décision — texte
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
                'Campagne juridique (module 20, v2.3 du 26/10/2026) : 37 scénarios ajoutés — 23 conformes (15 vérifiés par tests unitaires/preuves BAL-009 + 7 scénarios L3141-7 + JUR-026 conformité technique du mécanisme RH, exécutés par Pi — test automatisé), 14 bloqués (13 fonctionnalités non gérées/applicabilité Syntec à confirmer + JUR-037 conformité juridique des arrêts maladie en attente de validation RH). '
                'La campagne juridique reste EN COURS DE VALIDATION : aucune décision finale de recette n’est prononcée pour le module 20 tant que les 14 scénarios bloqués n’ont pas été traités ou arbitrés.')
            rr.append(tt)
            for r in runs[1:]:
                r._r.getparent().remove(r._r)

doc.save(DST)
print('DOCX v2.3 enregistré :', DST)
