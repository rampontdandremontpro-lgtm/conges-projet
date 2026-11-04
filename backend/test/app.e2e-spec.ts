import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { LeaveRequestSchedulerService } from './../src/leave-requests/leave-request-scheduler.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Solution de TEST déterministe : on remplace le scheduler par un stub
      // afin qu'aucune maintenance fire-and-forget ne s'exécute à
      // `onApplicationBootstrap`. Sans cela, `app.close()` fermait le pool
      // TypeORM pendant que `runMaintenance()` l'utilisait encore → « Pool is
      // closed ». Le comportement métier du scheduler n'est PAS modifié : ce
      // stub n'existe que dans ce contexte de test.
      .overrideProvider(LeaveRequestSchedulerService)
      .useValue({
        onApplicationBootstrap: () => undefined,
        onApplicationShutdown: () => undefined,
        runMaintenance: async () => ({
          runAt: new Date().toISOString(),
          remindersCreated: 0,
          expiredRequests: 0,
          consolidatedRequests: 0,
          notificationsReevaluated: 0,
          presenceStatusesRefreshed: 0,
          balanceReminders: null,
          errors: [],
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
