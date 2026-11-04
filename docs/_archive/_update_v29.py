# -*- coding: utf-8 -*-
"""Création du cahier v2.9 : consolidation JUR-019→022 (classification tri-état,
période d'origine, garde-fou déploiement) + JUR-023 période de prise implémentée."""
import shutil
from copy import deepcopy

import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.8.docx'
DST = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.9.docx'

VERSION = '2.9'
DATE = '29/10/2026'
TESTEUR = 'Pi — test automatisé'
PROOF_JUR = (
    'tests/recette/scripts/retest-jur019-022-integration.mjs (15/15 OK) ; '
    'retest-jur019-022-consolidation.mjs (10/10 OK) ; '
    'retest-jur019-022-classification.mjs (6/6 OK) ; _ui-extra-days.mjs (navigateur, 8/8 OK) ; '
    'fractionnement.util.spec.ts (11 tests) ; syntec-seniority.util.spec.ts (13 tests) ; '
    'schema-compatibility.spec.ts (3 tests)'
)
PROOF_JUR023 = 'tests/recette/scripts/retest-jur023-prise.mjs (5/5 OK) ; backend/src/leave-balances/take-period.util.spec.ts (5 tests)'

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

jur_updates = {
    'JUR-019': (
        'Attribution automatique opérationnelle et idempotente (mouvement SENIORITY_EXTRA + audit) : paliers '
        '5/10/15/20 ans → +1/+2/+3/+4 jours ouvrés, appréciée à la date de référence configurable. Conditionnée à la '
        'configuration RH par entité. Cohérence des unités (consommation 1:1) vérifiée.',
        'Applicabilité Syntec à confirmer pour chaque entité. Les jours d’ancienneté sont ajoutés au compteur ordinaire '
        '(1 jour ouvré = 1 jour consommé 1:1, sans conversion).'
    ),
    'JUR-020': (
        'Ancienneté calculée à la date de référence configurable (1er mai par défaut) : années révolues, frontières '
        '4 ans 364 j vs 5 ans, anniversaire avant/après le 1er mai.',
        'La date de référence par défaut (1er mai) doit être confirmée par la RH ; paramétrable sans code.'
    ),
    'JUR-021': (
        'Calcul automatique sur les congés réellement pris hors période (jours ouvrés lundi→vendredi, fériés et '
        'demi-journées gérés). Classification fiable des demandes (UNDETERMINED/MAIN/FIFTH_WEEK) : une demande non '
        'classifiée n’est jamais comptée ; reclassification RH tracée (PATCH /leave-requests/:id/classification). '
        'Période d’origine réelle (compteur N débité, part N-1 reportée exclue). Attribution idempotente, recalcul '
        'transactionnel concurrentiel.',
        'Régime Syntec configurable par entité. Conditions de fractionnement et renonciation individuelle écrite à '
        'confirmer par la RH. La 5e semaine (marquée) est exclue ; plafond 20 jours ouvrés en filet de sécurité.'
    ),
    'JUR-022': (
        'Régime supplétif L3141-23 (jours ouvrables lundi→samedi) : 3-5 jours hors période → +1, ≥6 jours → +2. '
        'Classification fiable et période d’origine réelle identiques à JUR-021. Régime configurable par entité, sans '
        'cumul avec Syntec.',
        'Régime supplétif (à défaut de disposition plus favorable) ; à confirmer avec la RH. Plafond 24 jours '
        'ouvrables en filet de sécurité.'
    ),
}

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in jur_updates:
        obtained, comment = jur_updates[cid]
        update_row(r._tr, PROOF_JUR, obtained, comment)
        print('scénario mis à jour :', cid)
    elif cid == 'JUR-023':
        update_row(
            r._tr,
            PROOF_JUR023,
            'Fenêtre de prise calculée et paramétrable (1er mai par défaut, 13 mois : 01/05/AAAA → 31/05/AAAA+1) ; '
            'statut aux dates limites (non ouverte / dans la période / échéance proche / dépassée) ; soldes N non pris '
            'listés et non supprimés (reportables via clôture/transfert). Endpoint RH et écran dédiés.',
            'Dates exactes (1er mai, 13 mois) et procédure de report au-delà sur demande écrite à confirmer par la RH ; '
            'fenêtre et seuil d’alerte paramétrables.'
        )
        print('scénario mis à jour : JUR-023')

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

# T02 — historique v2.9
hist = doc.tables[2]
new = hist.add_row()
vals = [
    VERSION, DATE, 'Pi — test automatisé',
    'JUR-019/020/021/022 : classification tri-état des demandes (UNDETERMINED/MAIN/FIFTH_WEEK), reclassification RH '
    'tracée, période d’origine réelle (N vs N-1 reporté), garde-fou de schéma au démarrage. JUR-023 : période de prise '
    '13 mois implémentée (fenêtre, dates limites, soldes non pris non supprimés).',
    'Recette historique acceptée (420/420) ; campagne juridique : 443 conformes, 5 conformes techniquement, '
    '9 bloqués — EN COURS DE VALIDATION.',
]
for i, v in enumerate(vals):
    set_simple_cell(new.cells[i], v)

# Totaux : 5 techniquement conformes, 9 bloqués.
tot = doc.tables[30]
for r in tot.rows:
    label = r.cells[0].text.strip()
    if label == 'Scénarios techniquement conformes (homologation RH en attente)':
        set_simple_cell(r.cells[1], '5')
    elif label == 'Scénarios bloqués':
        set_simple_cell(r.cells[1], '9')
    elif label.startswith('Avancement global'):
        set_simple_cell(
            r.cells[1],
            '98,0 % (448 scénarios traités / 457 : 443 conformes + 5 techniquement conformes ; 9 bloqués)',
        )
    elif label.startswith('Taux de réussite'):
        set_simple_cell(r.cells[1], '100 % (443 conformes / 443 scénarios exécutés)')

doc.save(DST)
print('DOCX v2.9 enregistré :', DST)
