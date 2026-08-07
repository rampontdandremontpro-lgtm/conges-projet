import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { AuditService } from './audit.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      return next.handle();
    }

    if (request.path.startsWith('/api/auth/')) {
      return next.handle();
    }

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const routePath = request.route?.path
            ? String(request.route.path)
            : request.path;
          const resourceId = this.parseResourceId(request.params?.id);

          void this.auditService
            .record({
              actorId: request.user?.id ?? null,
              action: `HTTP_${request.method}`,
              resourceType: this.resourceTypeFromPath(request.path),
              resourceId,
              oldValue: null,
              newValue: {
                method: request.method,
                route: routePath,
                statusCode: response.statusCode,
                durationMs: Date.now() - startedAt,
                body: this.sanitize(request.body),
              },
              ipAddress: this.getIpAddress(request),
            })
            .catch(() => undefined);
        },
      }),
    );
  }

  private resourceTypeFromPath(path: string): string {
    const firstSegment = path
      .replace(/^\/api\//, '')
      .split('/')
      .filter(Boolean)[0];

    return (firstSegment || 'APPLICATION')
      .replace(/-/g, '_')
      .toUpperCase();
  }

  private parseResourceId(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private getIpAddress(request: Request): string | null {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim().slice(0, 64);
    }

    return request.ip?.slice(0, 64) ?? null;
  }

  private sanitize(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const forbiddenKeys = new Set([
      'password',
      'passwordHash',
      'token',
      'signatureData',
      'employeeSignatureData',
      'validatorSignatureData',
      'file',
    ]);
    const result: Record<string, unknown> = {};

    for (const [key, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      // Les clés sensibles sont supprimées intégralement (ni nom, ni valeur)
      // pour ne jamais exposer leur existence dans les journaux d'audit.
      if (forbiddenKeys.has(key)) {
        continue;
      }

      result[key] = this.sanitize(childValue);
    }

    return result;
  }
}
