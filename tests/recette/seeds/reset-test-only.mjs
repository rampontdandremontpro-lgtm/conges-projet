// Réinitialisation TEST-ONLY — ne lit JAMAIS la base réelle.
// Cible : gestion_conges_gmes_test (garde-fou dur).
// Vide les tables métier mais conserve les 8 comptes de recette et les réglages.
import mysql from 'mysql2/promise'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGET_DB = 'gestion_conges_gmes_test'

function readEnv(fileName) {
  try {
    const filePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../backend',
      fileName,
    )
    const values = {}
    for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const sep = line.indexOf('=')
      if (sep < 1) continue
      values[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
    }
    return values
  } catch {
    return {}
  }
}

const env = { ...readEnv('.env.recette'), ...process.env }
const SEED_EMAILS = [
  'admin.recette@gmes.fr', 'rh.recette@gmes.fr', 'directeur.recette@gmes.fr',
  'responsable.recette@gmes.fr', 'col-a.recette@gmes.fr', 'col-b.recette@gmes.fr',
  'col-c.recette@gmes.fr', 'col-prorata.recette@gmes.fr',
]

async function main() {
  const conn = await mysql.createConnection({
    host: env.DB_HOST ?? '127.0.0.1',
    port: Number(env.DB_PORT ?? '3307'),
    user: env.DB_USERNAME ?? 'recette',
    password: env.DB_PASSWORD ?? '',
    database: TARGET_DB,
    multipleStatements: true,
  })
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db')
  if (db !== TARGET_DB) throw new Error(`Garde-fou : base ${db} inattendue`)

  await conn.query('SET FOREIGN_KEY_CHECKS = 0')
  const tables = ['leave_requests', 'balance_movements', 'lot_allocations', 'carryover_lots', 'carryover_notifications', 'carryover_reception_proofs', 'leave_balances', 'derogations', 'documents', 'audit_logs', 'notifications', 'presence_snapshots', 'take_period_reports', 'leave_arrete_restaurations']
  for (const t of tables) {
    try { await conn.query(`DELETE FROM \`${t}\``) } catch { /* table absente */ }
  }
  // Supprime les données créées par les tests, sauf les comptes de recette.
  await conn.query(`DELETE FROM leave_types`)
  await conn.query(`DELETE FROM services`)
  await conn.query(`DELETE FROM legal_entities`)
  await conn.query(`DELETE FROM users WHERE email NOT IN (${SEED_EMAILS.map(() => '?').join(',')})`, SEED_EMAILS)
  await conn.query('SET FOREIGN_KEY_CHECKS = 1')

  // Référentiel statique requis par l'application (entreprises de rattachement).
  await conn.query(`INSERT INTO legal_entities (code, name, logo_key, is_active, sort_order) VALUES ('GMES', 'GMES', 'gmes-logo', 1, 0), ('EFFICIENCE', 'Efficience', NULL, 1, 1), ('GMES_INGENIERIE', 'GMES Ingénierie', NULL, 1, 2)`)
  const [[gmes]] = await conn.query("SELECT id FROM legal_entities WHERE code = 'GMES'")
  await conn.query("UPDATE users SET legal_entity_id = ? WHERE employment_type = 'INTERNE'", [gmes.id])
  // Marqueurs de clôture de période créés par les tests (sinon 409 au rejeu).
  await conn.query("DELETE FROM settings WHERE setting_key LIKE 'REFERENCE_PERIOD_CLOSED%'")
  // Réglages JUR-028 (présents par défaut, fonctionnalité désactivée).
  await conn.query("INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES ('ARRET_CHEVAUCHEMENT_ENABLED','false','JUR-028 - restitution automatique des conges couverts par un arret maladie'), ('ARRET_MALADIE_TYPE_IDS','','JUR-028 - identifiants des types arret maladie (separes par des virgules)')")

  const [users] = await conn.query('SELECT COUNT(*) n FROM users')
  console.log(`RESET TEST-ONLY OK — users restants : ${users[0].n}`)
  await conn.end()
}

main().catch((e) => { console.error('ERREUR RESET TEST-ONLY :', e); process.exit(1) })
