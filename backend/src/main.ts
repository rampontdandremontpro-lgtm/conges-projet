import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from './app.module';
import { assertDatabaseSchemaCompatible } from './database/schema-compatibility';

async function bootstrap(): Promise<void> {
  // Garde-fou recette JUR-027 (fail-fast avant toute connexion) : toute recette
  // activée par CARRYOVER_LOTS_ENABLED=true doit cibler la base de test.
  const rawDatabase = process.env.DB_DATABASE ?? '';
  const carryoverEnabled =
    process.env.CARRYOVER_LOTS_ENABLED === 'true';
  if (carryoverEnabled && rawDatabase !== 'gestion_conges_gmes_test') {
    throw new Error(
      `Garde-fou recette JUR-027 : CARRYOVER_LOTS_ENABLED=true exige DB_DATABASE=gestion_conges_gmes_test ` +
        `(base actuelle : « ${rawDatabase || 'non définie (fallback .env)'} »).`,
    );
  }

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Garde-fou de schéma (déploiement) : échoue avant l'écoute si le schéma est
  // incompatible (ex. colonne leave_requests.leave_classification absente).
  await assertDatabaseSchemaCompatible(app.get(DataSource));

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: 'http://localhost:5173',
    credentials: true,
    exposedHeaders: [
      'Content-Disposition',
      'X-Document-Reference',
      'X-Document-Checksum',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(configService.get<string>('PORT', '3000'));

  await app.listen(port);

  console.log(`API disponible sur http://localhost:${port}/api`);
}

void bootstrap();