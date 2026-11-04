# -*- coding: utf-8 -*-
"""Corrections ciblées du cahier v2.0 (sans modifier v1.9 ni le code)."""
import docx
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

DOCX = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.0.docx'

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
    import copy
    return copy.deepcopy(rpr) if rpr is not None else None

def make_run(rpr, parts):
    r = _el('r')
    if rpr is not None:
        import copy
        r.append(copy.deepcopy(rpr))
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

def set_run_text(run, text):
    r = run._r
    for child in list(r):
        if child.tag in (qn('w:t'), qn('w:br'), qn('w:tab')):
            r.remove(child)
    t = _el('t')
    t.set(qn('xml:space'), 'preserve')
    t.text = text
    r.append(t)

def fill_row(row_el, scen):
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
    p.append(make_run(rpr, [('br', None), ('t', 'Testeur : D.RAMPONT')]))

# ---------------------------------------------------------------------------
# Scénarios modifiés (données complètes)
# ---------------------------------------------------------------------------
UPD = {}

def u(id_, prio, scen, role, precond, steps, expected, proof, status, obtained, comment, dtest):
    UPD[id_] = dict(id=id_, prio=prio, scen=scen, role=role, precond=precond,
                    steps=steps, expected=expected, proof=proof, status=status,
                    obtained=obtained, comment=comment, dtest=dtest)

u('JUR-001', 'P1',
  'Acquisition mensuelle de 2,5 jours ouvrables par mois de travail effectif — Réf. L3141-3',
  'RH',
  'Période de référence 2026-2027 ouverte ; collaborateur actif embauché avant le 01/06/2026 ; taux mensuel configuré à 2,50 jours ; base gestion_conges_gmes_test.',
  ['Lancer l’acquisition mensuelle (POST /leave-balances/accrual/run) pour un mois complet (ex. août 2026).',
   'Consulter le compteur N du collaborateur (GET /leave-balances/employee/:id?referencePeriod=2026-2027&counterType=N).',
   'Vérifier le mouvement d’ACQUISITION créé.'],
  'Un mouvement d’ACQUISITION de +2,50 jours ouvrables est crédité pour un mois complet de travail effectif ; le cumul annuel plafonne à 30 jours ouvrables.',
  'Jest — monthly-accrual.service.spec.ts > I > « mois complet 01/07 → 31/07 : 31 jours, crédit 2,50 » + retest-bal009-prorata.json > CASE C (mouvement +2,50 jours)',
  'Conforme',
  '+2,50 jours crédités pour un mois complet (computeCredit(31,31)=2,5 ; mouvement « Acquisition mensuelle de juillet 2026 : +2,5 jours » conforme).',
  '', '20/10/2026')

u('JUR-002', 'P1',
  'Plafond de 30 jours ouvrables de congés payés de base — Réf. L3141-3',
  'RH',
  'Droit acquis proche ou égal au plafond légal de 30 jours ouvrables.',
  ['Vérifier roundAcquiredDaysUp sur 29,01, 30,99 et 31.'],
  'L’arrondi du droit acquis ne dépasse jamais 30 jours ouvrables (plafond L3141-3).',
  'Jest — reference-period-rounding.util.spec.ts > roundAcquiredDaysUp > « 30,99 → 30 ; 31 → 30 »',
  'Conforme',
  'roundAcquiredDaysUp(30,99)=30 ; roundAcquiredDaysUp(31)=30 (plafond respecté).',
  'Le cumul d’une année complète (12 × 2,5 = 30) est vérifié à la clôture par JUR-012 (À tester) ; le plafond d’arrondi est démontré ici par test unitaire.', '20/10/2026')

u('JUR-003', 'P1',
  'Décompte en jours ouvrables : semaine complète + samedi GMES — Réf. L3141-3 et règle interne GMES',
  'Multi-rôles',
  'Demande de congé du lundi 05/01/2026 au vendredi 09/01/2026 après-midi.',
  ['Créer la demande de congé (lundi 05/01 → vendredi 09/01 après-midi).',
   'Vérifier le décompte calculé (calculateDeductedLeaveDays).'],
  '5 jours ouvrables (lundi → vendredi) + samedi 10/01 décompté (règle interne GMES) = 6 jours.',
  'Jest — conformite-legale.spec.ts > « semaine complète du lundi au vendredi après-midi : 5 jours + samedi GMES = 6 »',
  'Conforme',
  'décompte = 6 jours (5 jours ouvrables + samedi GMES).',
  'Le décompte du samedi est une règle interne GMES, distincte du décompte légal en jours ouvrables.', '20/10/2026')

u('JUR-004', 'P1',
  'Le dimanche n’est pas un jour ouvrable : borne refusée et jamais décompté — Réf. L3141-2 / L3141-3',
  'Multi-rôles',
  'Congé englobant un dimanche en cours de période (ex. vendredi 09/01/2026 → lundi 12/01/2026).',
  ['Tenter de créer une demande débutant (ou se terminant) un dimanche.',
   'Vérifier le refus (borne dimanche interdite).',
   'Poser un congé englobant un dimanche en cours de période (vendredi → lundi) et vérifier que le dimanche n’est pas décompté.'],
  'Borne dimanche refusée (HTTP 400 « La date de début/fin ne peut pas être un dimanche. », conforme à LEA-011). Le dimanche n’est jamais décompté : la fonction de décompte exclut systématiquement les dimanches.',
  'LEA-011 (recette, Conforme) + Jest — conformite-legale.spec.ts > « le dimanche seul n’est jamais décompté »',
  'Conforme',
  'borne dimanche refusée HTTP 400 (LEA-011) ; décompte d’un dimanche = 0 (Jest).',
  'Aligné sur LEA-011 : une demande commençant ou finissant un dimanche est refusée ; un dimanche englobé en cours de période est exclu du décompte.', '20/10/2026')

u('JUR-005', 'P1',
  'Jour férié légal exclu du décompte — Réf. L3133-1 / L3141-3',
  'Multi-rôles',
  'Jour férié légal du mercredi 11/11/2026 (Armistice) déclaré non décomptable dans GMES ; congé du mardi 10/11/2026 au jeudi 12/11/2026.',
  ['Déclarer le 11/11/2026 comme jour non décomptable.',
   'Poser un congé du mardi 10/11/2026 au jeudi 12/11/2026.',
   'Vérifier le décompte.'],
  'Le 11/11 (jour férié) est exclu ; décompte = 2 jours ouvrables (mardi 10/11 et jeudi 12/11).',
  'Jest — conformite-legale.spec.ts > « un jour férié (non décomptable) au milieu du congé est exclu »',
  'Conforme',
  'décompte = 2 jours (11/11 exclu).',
  'Le test unitaire illustre le mécanisme avec un jour non décomptable générique (02/11/2026) ; le scénario utilise le 11/11/2026 (Armistice, jour férié légal).', '20/10/2026')

u('JUR-006', 'P1',
  'Prise en demi-journée (MATIN / APRES_MIDI) — Réf. L3141-3',
  'Multi-rôles',
  'Congé du 05/01/2026 au 06/01/2026 saisi en demi-journées.',
  ['Poser un congé débutant l’après-midi du 05/01/2026 et se terminant l’après-midi du 06/01/2026.',
   'Vérifier le décompte.'],
  'Début après-midi = 0,5 jour ; jour suivant complet = 1 jour ; total = 1,5 jour. Fin le matin = 0,5 jour.',
  'Jest — conformite-legale.spec.ts > « début en demi-journée (après-midi) » et « fin en demi-journée (matin) »',
  'Conforme',
  'début après-midi + jour complet = 1,5 ; fin matin = 0,5.',
  '', '20/10/2026')

u('JUR-007', 'P2',
  'Période d’acquisition du 1er juin au 31 mai — Réf. L3141-5 / Syntec 5.3 / config GMES',
  'RH',
  'Paramètre REFERENCE_PERIOD_START = 06-01.',
  ['Vérifier currentReferencePeriod aux dates 31/05/2026 et 01/06/2026.',
   'Vérifier les bornes de la période 2026-2027.'],
  '31/05/2026 → période 2025-2026 ; 01/06/2026 → 2026-2027 ; bornes 01/06/2026 → 31/05/2027.',
  'Jest — reference-period.util.spec.ts > A > « début 01/06/2026, fin 31/05/2027 » et « currentReferencePeriod autour de la bascule du 1er juin »',
  'Conforme',
  '31/05/2026 → 2025-2026 ; 01/06/2026 → 2026-2027 ; bornes conformes.',
  '', '20/10/2026')

u('JUR-008', 'P2',
  'Prorata d’arrivée en cours de période — Réf. BAL-009 (règle interne GMES)',
  'RH',
  'Collaborateur embauché le 16/07/2026 ; taux mensuel 2,50 j/mois.',
  ['Exécuter l’acquisition de juillet 2026.',
   'Vérifier le crédit du mois de juillet.'],
  'Prorata calendaire GMES : 2,50 × 16/31 = 1,29 jour (jour d’arrivée inclus) ; crédit de 1,29 jour.',
  'Jest — monthly-accrual.service.spec.ts > I > « arrivée 16/07 : 16 jours de présence, crédit 1,29 » + retest-bal009-prorata.json > CASE A',
  'Conforme',
  'crédit 1,29 jour (présence 16/31) ; mouvement « Acquisition proratisée de juillet 2026 : +1,29 jour(s) » conforme.',
  'Le prorata calendaire est une règle applicative GMES, pas une obligation légale générale.', '20/10/2026')

u('JUR-009', 'P2',
  'Prorata de départ en cours de période — Réf. BAL-009 (règle interne GMES)',
  'RH',
  'Collaborateur avec date de sortie au 15/07/2026 ; taux mensuel 2,50 j/mois.',
  ['Enregistrer la date de sortie au 15/07/2026.',
   'Exécuter l’acquisition de juillet 2026.',
   'Vérifier le crédit.'],
  'Prorata calendaire GMES : 2,50 × 15/31 = 1,21 jour (jour de départ inclus) ; crédit de 1,21 jour.',
  'Jest — monthly-accrual.service.spec.ts > I > « départ 15/07 : 15 jours, crédit 1,21 » + retest-bal009-prorata.json > CASE B',
  'Conforme',
  'crédit 1,21 jour (présence 15/31) ; mouvement « Acquisition proratisée de juillet 2026 : +1,21 jour(s) » conforme.',
  '', '20/10/2026')

u('JUR-010', 'P1',
  'Arrondi légal L3141-7 : droit acquis porté à l’entier supérieur — Réf. L3141-7',
  'RH',
  'Collaborateur embauché le 16/07/2026 ; droit brut = 26,29 jours ouvrables.',
  ['Vérifier roundAcquiredDaysUp(26,29).',
   'Vérifier que l’arrondi porte sur le droit acquis (acquiredDays), jamais sur le solde restant (availableDays).'],
  '26,29 → 27 jours ouvrables définitifs (entier immédiatement supérieur) ; le solde restant n’est pas arrondi à la hausse par L3141-7.',
  'Jest — reference-period-rounding.util.spec.ts > roundAcquiredDaysUp > « 26,29 → 27 »',
  'Conforme',
  'roundAcquiredDaysUp(26,29) = 27.',
  'L’application de cet arrondi à la clôture réelle (supplément +0,71) est couverte par JUR-012 (À tester).', '20/10/2026')

u('JUR-011', 'P1',
  'Arrondi L3141-7 plafonné à 30 jours ouvrables — Réf. L3141-7 + L3141-3',
  'RH',
  'Droit acquis proche ou égal au plafond légal.',
  ['Vérifier roundAcquiredDaysUp sur 29,01, 30,99 et 31.'],
  '29,01 → 30 ; 30,99 → 30 ; 31 → 30 ; l’arrondi ne dépasse jamais le plafond de 30 jours ouvrables.',
  'Jest — reference-period-rounding.util.spec.ts > roundAcquiredDaysUp > « 29,01 → 30 ; 30,99 → 30 ; 31 → 30 »',
  'Conforme',
  '29,01 → 30 ; 30,99 → 30 ; 31 → 30 (plafond respecté).',
  '', '20/10/2026')

u('JUR-013', 'P1',
  'Règle GMES de transfert N → N-1 inchangée (distincte de l’arrondi légal L3141-7)',
  'RH',
  '26,5 jours disponibles en N après consommation (solde disponible).',
  ['Vérifier roundPeriodCloseDays(26,5).',
   'Vérifier que cette règle s’applique au solde disponible transféré, pas au droit acquis.'],
  '26,5 jours disponibles → 27 jours transférés en N-1 (arrondi au plus proche du solde disponible, règle GMES). Cette règle est distincte de l’arrondi légal L3141-7 et ne constitue pas une anomalie.',
  'Jest — reference-period-rounding.util.spec.ts > roundPeriodCloseDays > « 14,5 → 15 ; 0,5 → 1 ; 0,49 → 0 »',
  'Conforme',
  'roundPeriodCloseDays arrondit au plus proche (14,5 → 15 ; 0,49 → 0), distinct de l’arrondi à l’entier supérieur.',
  'Le cas exact 26,5 → 27 du transfert réel à la clôture est couvert par JUR-012 / JUR-035 (À tester). Décision métier : la règle GMES de transfert reste inchangée.', '20/10/2026')

u('JUR-032', 'P2',
  'Évolutions conventionnelles Syntec en vigueur en 2026 (ex. congé supplémentaire de naissance) — Réf. Syntec (version en vigueur 2026)',
  'RH / Juridique',
  'Version en vigueur de la convention Syntec identifiée sur Légifrance.',
  ['Identifier la version en vigueur de Syntec au 20/10/2026.',
   'Vérifier les nouvelles dispositions applicables (ex. congé supplémentaire de naissance).'],
  'Les dispositions 2026 en vigueur sont identifiées et vérifiées avant toute mise en œuvre.',
  'À confirmer sur Légifrance — convention Syntec (IDCC 1486)',
  'Bloqué',
  'Non vérifié : dépend de la version en vigueur de la convention.',
  'À confirmer sur Légifrance ; ne pas présumer l’applicabilité.', '')

u('JUR-033', 'P1',
  'Délais de prévenance 30/60 jours et seuil de 21 jours — Réf. règle interne GMES (pas une obligation légale)',
  'Multi-rôles',
  'Configuration GMES : délai normal 30 jours, délai spécial 60 jours, seuil congé long 21 jours.',
  ['Évaluer la prévenance pour 21 jours calendaires.',
   'Évaluer la prévenance pour 20 jours calendaires.'],
  '21 jours calendaires → 60 jours ; 20 jours → 30 jours. Ces seuils sont des règles internes GMES, pas des délais légaux.',
  'Jest — conformite-legale.spec.ts > CONFORMITÉ G > « seuil congé long : 21 jours calendaires → 60 jours, 20 jours → 30 jours »',
  'Conforme',
  '21 jours → 60 jours ; 20 jours → 30 jours.',
  'Règle interne GMES, distincte des obligations légales.', '20/10/2026')

u('JUR-034', 'P1',
  'Période estivale 01/05 → 31/10 — Réf. règle interne GMES',
  'Multi-rôles',
  'Configuration GMES : période estivale du 01/05 au 31/10.',
  ['Évaluer un congé se terminant le 30/04.',
   'Évaluer un congé débutant le 01/05.',
   'Évaluer un congé se terminant le 31/10 et un débutant le 01/11.'],
  'Fin au 30/04 → hors période estivale (30 jours) ; début au 01/05 → période estivale (60 jours) ; fin au 31/10 → période estivale ; début au 01/11 → hors période.',
  'Jest — conformite-legale.spec.ts > CONFORMITÉ G > « frontière du 1er mai » et « frontière du 31 octobre »',
  'Conforme',
  'bornes 01/05 et 31/10 correctement gérées.',
  'Règle interne GMES.', '20/10/2026')

u('JUR-036', 'P2',
  'Décompte du samedi et demi-journées — Réf. règle interne GMES',
  'Multi-rôles',
  'Demandes de congé sur des semaines complètes et en demi-journées.',
  ['Poser une semaine complète (lundi → vendredi).',
   'Poser des demi-journées MATIN / APRES_MIDI.'],
  'Le samedi est décompté en fin de semaine complète (règle GMES) ; les demi-journées sont décomptées à 0,5 jour.',
  'Jest — conformite-legale.spec.ts > « semaine complète du lundi au vendredi après-midi : 5 jours + samedi GMES = 6 » + tests demi-journées',
  'Conforme',
  'samedi décompté (6 jours pour une semaine complète) ; demi-journées = 0,5 jour.',
  'Le décompte du samedi est une règle interne GMES, distincte du régime légal.', '20/10/2026')

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
doc = docx.Document(DOCX)

# 1) Table des scénarios du module 20 = dernière table 8 colonnes après le module 19.
#    On la repère par son en-tête.
scen_table = None
for t in doc.tables:
    if t.rows and t.rows[0].cells[0].text.strip() == 'ID':
        # la table du module 20 est celle qui contient JUR-001
        if any(r.cells[0].text.strip() == 'JUR-001' for r in t.rows[1:]):
            scen_table = t
            break
assert scen_table is not None, 'table module 20 introuvable'

for r in scen_table.rows[1:]:
    cid = r.cells[0].text.strip()
    if cid in UPD:
        fill_row(r._tr, UPD[cid])
        print('scénario mis à jour :', cid)

# 2) Table de correspondance (en-tête « Référence juridique »)
for t in doc.tables:
    if t.rows and t.rows[0].cells[0].text.strip() == 'Référence juridique':
        set_simple_cell(t.rows[0].cells[1],
                        'Objet (d’après conformite-legale.spec.ts — à confirmer sur Légifrance / Service-Public)')
        break

# 3) Description du module 20
for p in doc.paragraphs:
    if p.text.strip().startswith('Vérifier la conformité de l’application') or \
       p.text.strip().startswith("Vérifier la conformité de l'application"):
        runs = p.runs
        if runs:
            set_run_text(runs[0],
                'Vérifier la conformité de l’application aux dispositions du Code du travail en vigueur, à la convention collective Syntec (IDCC 1486) sous réserve de son applicabilité à chaque entreprise de rattachement (GMES, Efficience, GMES Ingénierie), et aux règles internes GMES. '
                'Les références juridiques citées sont issues de l’analyse documentée dans backend/src/leave-balances/conformite-legale.spec.ts (sources Légifrance / Service-Public citées dans ce fichier) ; elles n’ont pas été re-vérifiées directement sur Légifrance dans le cadre de la présente campagne et devront être confirmées sur les textes officiels en vigueur avant validation définitive.')
            for r in runs[1:]:
                r._r.getparent().remove(r._r)
        break

# 4) Statut du document (T01)
info = doc.tables[1]
for r in info.rows:
    if r.cells[0].text.strip() == 'Statut du document':
        set_simple_cell(r.cells[1],
                        'Recette historique acceptée (420/420) — campagne juridique (module 20) EN COURS DE VALIDATION.')
        break

# 5) Historique v2.0 (T02)
hist = doc.tables[2]
for r in hist.rows:
    if r.cells[0].text.strip() == '2.0':
        set_simple_cell(r.cells[4],
                        'Recette historique acceptée (420/420) ; campagne juridique (module 20) EN COURS DE VALIDATION (15 conformes, 7 à tester, 14 bloqués).')
        break

# 6) Décision : décocher « validée avec réserves », mettre à jour le texte
for p in doc.paragraphs:
    t = p.text
    if t.strip() == '☒ Recette validée avec réserves':
        for r in p.runs:
            if '☒' in r.text:
                r.text = r.text.replace('☒', '☐')
    elif t.strip().startswith('Recette historique exécutée du'):
        runs = p.runs
        if runs:
            set_run_text(runs[0],
                'Recette historique (v1.9) exécutée du 22/09/2026 au 12/10/2026 : LOT 1 à LOT 6, évolution fonctionnelle RH-only et BAL-009 validés, 420/420 scénarios conformes, aucune anomalie ouverte — validation historique conservée. '
                'Campagne juridique complémentaire (module 20, v2.0 du 20/10/2026) : 36 scénarios ajoutés — 15 conformes, 7 à exécuter, 14 bloqués (fonctionnalités non gérées et/ou applicabilité Syntec à confirmer). '
                'La campagne juridique est EN COURS DE VALIDATION : aucune décision finale de recette n’est prononcée pour le module 20 tant que les 7 scénarios à exécuter et les 14 scénarios bloqués n’ont pas été traités ou arbitrés.')
            for r in runs[1:]:
                r._r.getparent().remove(r._r)

# 7) Synthèse/décision (T28) : distinguer taux de réussite et avancement global
dec = doc.tables[30]
for r in dec.rows:
    k = r.cells[0].text.strip()
    if k == 'Taux de réussite':
        set_simple_cell(r.cells[0], 'Taux de réussite (scénarios exécutés)')
        set_simple_cell(r.cells[1], '100 % (435 conformes / 435 scénarios exécutés)')
# ajouter une ligne « Avancement global de la recette »
new = dec.add_row()
set_simple_cell(new.cells[0], 'Avancement global de la recette')
set_simple_cell(new.cells[1], '95,4 % (435 conformes / 456 scénarios ; 21 non exécutés : 7 à tester + 14 bloqués)')

doc.save(DOCX)
print('Corrections v2.0 enregistrées.')
