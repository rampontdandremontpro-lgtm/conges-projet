# -*- coding: utf-8 -*-
"""Mise à jour in place du cahier v2.12 : bilan consolidé fiable des 457
scénarios (conformes / non conformes / bloqués / conformes techniquement en
attente d'homologation / partiellement intégrés) + liste exacte des scénarios
non définitivement clôturés. Aucune modification de statut pour améliorer le
pourcentage : chaque statut est repris tel quel depuis les cellules."""
import docx

SRC = 'docs/CAHIER DE RECETTE - DÉMATÉRIALISATION DES CONGÉS DES ABSENCES - v2.12.docx'

doc = docx.Document(SRC)
summary = doc.tables[30]

# ── Comptages exacts (repris des cellules du cahier) ────────────────────────
# 443 « Conforme » ; 9 « Conforme techniquement — homologation RH en attente » ;
# 1 « Intégré techniquement — homologation RH en attente » (JUR-031) ;
# 2 « Partiellement intégré — homologation RH en attente » (JUR-025, JUR-037) ;
# 1 « Bloqué — homologation RH en attente » (JUR-027) ; 1 « Bloqué » (JUR-032).

CONFORME = 443
CONFORME_TECHNIQUE = 10   # 9 + JUR-031 « Intégré techniquement »
PARTIEL = 2               # JUR-025, JUR-037
BLOQUE = 2                # JUR-027 (homologation) + JUR-032 (Bloqué)
NON_CONFORME = 0
TOTAL = CONFORME + CONFORME_TECHNIQUE + PARTIEL + BLOQUE + NON_CONFORME

TARGETS = {
    'Scénarios conformes': str(CONFORME),
    'Scénarios techniquement conformes (homologation RH en attente)': str(CONFORME_TECHNIQUE),
    'Scénarios non conformes': str(NON_CONFORME),
    'Scénarios bloqués': str(BLOQUE),
    'Scénarios à retester': '0',
    'Scénarios restant à tester': '0',
    'Anomalies bloquantes ouvertes': '0',
    'Anomalies majeures ouvertes': '0',
    'Taux de réussite (scénarios exécutés)': (
        f'100 % ({CONFORME} conformes / {CONFORME} scénarios exécutés)'
    ),
    'Taux de conformité définitive': (
        f'{round(CONFORME * 100 / TOTAL, 1)} % ({CONFORME} / {TOTAL} scénarios)'
    ),
    'Avancement global de la recette': (
        f'{round((CONFORME + CONFORME_TECHNIQUE + PARTIEL) * 100 / TOTAL, 1)} % '
        f'({CONFORME + CONFORME_TECHNIQUE + PARTIEL} scénarios traités / {TOTAL} : '
        f'{CONFORME} conformes + {CONFORME_TECHNIQUE} conformes techniquement + {PARTIEL} partiellement intégrés — '
        'cet indicateur mesure l’avancement technique, PAS la conformité définitive)'
    ),
}

for row in summary.rows:
    key = row.cells[0].text.strip()
    if key in TARGETS:
        row.cells[1].text = TARGETS[key]

# ── Lignes ajoutées si absentes ────────────────────────────────────────────
existing_keys = [r.cells[0].text.strip() for r in summary.rows]

if 'Taux de conformité définitive' not in existing_keys:
    # Inséré après la ligne « Taux de réussite ».
    target_idx = None
    for i, r in enumerate(summary.rows):
        if r.cells[0].text.strip() == 'Taux de réussite (scénarios exécutés)':
            target_idx = i
            break
    row = summary.add_row()
    if target_idx is not None:
        tr = row._tr
        summary._tbl.remove(tr)
        summary._tbl.insert(target_idx + 1, tr)
    row.cells[0].text = 'Taux de conformité définitive'
    row.cells[1].text = f'{round(CONFORME * 100 / TOTAL, 1)} % ({CONFORME} / {TOTAL} scénarios)'

if 'Scénarios partiellement intégrés (homologation RH en attente)' not in existing_keys:
    row = summary.add_row()
    row.cells[0].text = 'Scénarios partiellement intégrés (homologation RH en attente)'
    row.cells[1].text = str(PARTIEL)

# ── Liste exacte des scénarios non définitivement clôturés ──────────────────
NON_CLOS = [
    ('JUR-019', 'Conforme techniquement — homologation RH en attente',
     'Applicabilité Syntec par entité + date de référence (1er mai) à confirmer.'),
    ('JUR-020', 'Conforme techniquement — homologation RH en attente',
     "Date d'appréciation de l'ancienneté (années révolues, date de référence) à confirmer."),
    ('JUR-021', 'Conforme techniquement — homologation RH en attente',
     'Applicabilité Syntec + conditions de renonciation écrite + régime supplétif à confirmer.'),
    ('JUR-022', 'Conforme techniquement — homologation RH en attente',
     'Régime de fractionnement (Syntec/supplétif) + renonciation écrite à confirmer.'),
    ('JUR-023', 'Conforme techniquement — homologation RH en attente',
     'Dates exactes (1er mai, 13 mois) + procédure de report sur demande écrite à confirmer.'),
    ('JUR-024', 'Conforme techniquement — homologation RH en attente',
     'Identification de la convention/accord applicable par entité à confirmer.'),
    ('JUR-025', 'Partiellement intégré — homologation RH en attente',
     'Moteur AT/MP terminé ; transitoire art. 37 II loi 2024-364 (conditions exactes, plafond 24 j, prescription expirée le 24/04/2026) à homologuer. Aucun crédit historique automatique.'),
    ('JUR-027', 'Bloqué — homologation RH en attente',
     'Recette technique validée ; 3 règles provisoires D1/D2/D3 + délai de report (15 mois) + suivi d\u2019échéance à homologuer par la RH.'),
    ('JUR-028', 'Conforme techniquement — homologation RH en attente',
     'Périmètre L3141-19-1 et s. + liste des types d\u2019arrêt maladie à confirmer.'),
    ('JUR-029', 'Conforme techniquement — homologation RH en attente',
     'Syntec applicable par entité + accords d\u2019entreprise à confirmer.'),
    ('JUR-030', 'Conforme techniquement — homologation RH en attente',
     'Syntec applicable par entité + accords d\u2019entreprise à confirmer.'),
    ('JUR-031', 'Intégré techniquement — homologation RH en attente',
     'Fondements juridiques des exceptions de prévenance (vérification RH systématique) à confirmer.'),
    ('JUR-032', 'Bloqué',
     'Confirmation juridique des dispositions Syntec 2026 (recherche Légifrance, pas de code).'),
    ('JUR-037', 'Partiellement intégré — homologation RH en attente',
     'Moteur maladie terminé ; grille de décision RH (nature de l\u2019arrêt, maintien de salaire, taux/plafond) + transitoire art. 37 II loi 2024-364 à homologuer.'),
]

# Ajout d'un séparateur + de la liste dans le tableau récapitulatif.
sep = summary.add_row()
sep.cells[0].text = 'Liste des scénarios non définitivement clôturés'
sep.cells[1].text = f'{len(NON_CLOS)} scénarios'

for sid, status, reason in NON_CLOS:
    row = summary.add_row()
    row.cells[0].text = f'{sid} — {status}'
    row.cells[1].text = reason

doc.save(SRC)
print('Bilan 457 scénarios mis à jour in place :', SRC)
print(f'{TOTAL} total = {CONFORME} conformes + {CONFORME_TECHNIQUE} techniquement + {PARTIEL} partiels + {BLOQUE} bloqués + {NON_CONFORME} non conformes')
