// JUR-027 — Lot L1 : inventaire historique des reports exceptionnels (LECTURE SEULE).
// Aucune écriture : uniquement des SELECT/SHOW. Ne qualifie jamais un report
// sur la seule base d'un motif contenant « maladie ». N'invente aucun reliquat.
import { openConnection } from './l1-migrate.mjs'

const RESULTS = []

function rec(name, ok, detail = '') {
  RESULTS.push({ name, ok, detail })
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' — ' + detail : ''}`)
}

const fmtDays = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} j`)

async function main() {
  const conn = await openConnection()
  try {
    // Credits des reports exceptionnels (cible) uniquement :
    // mouvement CORRECTION_POSITIVE dont la raison commence par REPORT_EXCEPTIONNEL| .
    const [credits] = await conn.query(`
      SELECT m.id AS movement_id,
             m.employee_id,
             CONCAT(u.nom, ' ', u.prenom) AS employee_name,
             m.days,
             m.created_at,
             m.reason,
             b.id AS balance_id,
             b.reference_period AS target_period,
             b.counter_type AS target_counter,
             b.available_days AS target_available
      FROM balance_movements m
      JOIN users u ON u.id = m.employee_id
      JOIN leave_balances b ON b.id = m.leave_balance_id
      WHERE m.movement_type = 'CORRECTION_POSITIVE'
        AND m.reason LIKE 'REPORT_EXCEPTIONNEL|%'
      ORDER BY m.created_at ASC, m.id ASC
    `)

    console.log(`Reports exceptionnels historiques : ${credits.length}`)
    console.log('')

    if (credits.length === 0) {
      console.log('Aucun report exceptionnel historique à inventorier (base vierge).')
    }

    for (const c of credits) {
      const parts = String(c.reason ?? '').split('|')
      const sourcePeriod = parts[1] ?? '—'
      const motif = parts.slice(2).join('|') || '—'

      const [agg] = await conn.query(
        `SELECT
           COALESCE(SUM(CASE WHEN movement_type = 'DEDUCTION' THEN CAST(days AS DECIMAL(10,2)) ELSE 0 END),0) AS deducted,
           COALESCE(SUM(CASE WHEN movement_type = 'REMISE_A_ZERO' THEN CAST(days AS DECIMAL(10,2)) ELSE 0 END),0) AS reset
         FROM balance_movements WHERE leave_balance_id = ?`,
        [c.balance_id],
      )

      console.log('—'.repeat(70))
      console.log(`Collaborateur      : ${c.employee_name} (#${c.employee_id})`)
      console.log(`Période d'origine  : ${sourcePeriod}`)
      console.log(`Période destination: ${c.target_period} (compteur ${c.target_counter})`)
      console.log(`Date du report     : ${new Date(c.created_at).toISOString()}`)
      console.log(`Quantité reportée  : ${fmtDays(c.days)}`)
      console.log(`Motif enregistré   : ${motif}`)
      if (/maladie/i.test(motif)) {
        console.log(`  ⚠ le motif contient « maladie » mais NE suffit PAS à qualifier juridiquement le report`)
      }
      console.log(`Consommation associée (DEDUCTION sur le compteur) : ${fmtDays(agg[0].deducted)}`)
      console.log(`Remise à zéro associée (REMISE_A_ZERO)             : ${fmtDays(agg[0].reset)}`)
      console.log(`Solde actuel du compteur                           : ${fmtDays(c.target_available)}`)
      console.log(`État                : À VÉRIFIER (reliquat réel non établissable)`)

      rec(`Inventaire report #${c.movement_id}`, true, `${c.employee_name} ${fmtDays(c.days)}`)
    }

    const [totals] = await conn.query(`
      SELECT COUNT(*) AS nb, COALESCE(SUM(CAST(days AS DECIMAL(10,2))),0) AS total
      FROM balance_movements
      WHERE movement_type = 'CORRECTION_POSITIVE' AND reason LIKE 'REPORT_EXCEPTIONNEL|%'
    `)
    rec(
      'Inventaire exact (nb reports / total jours)',
      true,
      `${totals[0].nb} report(s), ${fmtDays(totals[0].total)}`,
    )
    rec('Lecture seule (aucune écriture réalisée)', true)
  } finally {
    await conn.end()
  }

  const failed = RESULTS.filter((r) => !r.ok).length
  console.log(`\nRÉSULTAT L1-INVENTAIRE : ${RESULTS.length - failed}/${RESULTS.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => {
  console.error('ERREUR :', error.message)
  process.exit(1)
})
