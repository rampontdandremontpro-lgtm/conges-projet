/**
 * Garde-fou e2e — exécuté par Jest AVANT tout chargement de module.
 *
 * Force l'environnement de test sur la base de recette et empêche qu'un test
 * e2e (notamment `app.e2e-spec.ts`, qui importe l'AppModule complet lisant
 * `backend/.env` avec `DB_DATABASE=gestion_conges_gmes`) ne se connecte à la
 * base réelle.
 *
 * La garde dure réside dans `AppModule` (TypeOrmModule.forRootAsync) : si
 * NODE_ENV=test et DB_DATABASE != gestion_conges_gmes_test, le bootstrap lève
 * une erreur AVANT toute connexion. Ce fichier garantit que DB_DATABASE vaut
 * bien la base de test lorsque la variable n'est pas fournie explicitement.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DB_DATABASE = 'gestion_conges_gmes_test';
process.env.DB_HOST = process.env.DB_HOST ?? 'localhost';
process.env.DB_PORT = process.env.DB_PORT ?? '3306';
process.env.DB_USERNAME = process.env.DB_USERNAME ?? 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? 'root';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'gmes_conges_secret_recette';
