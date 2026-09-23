// Protection explicite contre toute réinitialisation accidentelle d'une base de production.
// La réinitialisation de recette n'est autorisée que si :
//   - RECETTE_ENV === '1'
//   - la base cible est exactement gestion_conges_gmes_test
// Aucune suppression de base n'est effectuée ici sans ces deux conditions.

import { config } from '../helpers/config.mjs'

export function assertRecetteResetAllowed() {
  if (process.env.RECETTE_ENV !== '1') {
    throw new Error(
      'Réinitialisation refusée : RECETTE_ENV doit valoir "1" pour exécuter un reset de recette.',
    )
  }

  if (config.DB_DATABASE !== 'gestion_conges_gmes_test') {
    throw new Error(
      `Réinitialisation refusée : la base "${config.DB_DATABASE}" n'est pas la base de recette autorisée "gestion_conges_gmes_test".`,
    )
  }

  return true
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  try {
    assertRecetteResetAllowed()
    console.log('Environnement de recette vérifié : reset autorisé.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
