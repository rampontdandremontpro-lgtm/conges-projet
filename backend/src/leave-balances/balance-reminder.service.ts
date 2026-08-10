import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationChannel } from '../notifications/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { User, UserRole } from '../users/user.entity';
import {
  LeaveBalance,
  LeaveBalanceCounterType,
} from './leave-balance.entity';
import {
  balanceRecapType,
  balanceReminderType,
  currentReferencePeriod,
  formatFrenchDate,
  referencePeriodEndDate,
  reminderDeadlineLabel,
  reminderDeadlines,
  type ReminderDeadline,
} from './reference-period.util';

export interface BalanceReminderPayload {
  reminderKey: string;
  referencePeriod: string;
  reminderDate: string;
  usageDeadline: string;
  availableDays: number;
  reservedDays: number;
  potentialDays: number;
}

export interface BalanceRecapRow {
  employeeId: number;
  nom: string;
  prenom: string;
  service: string;
  referencePeriod: string;
  counterType: 'N-1';
  availableDays: number;
  reservedDays: number;
  potentialDays: number;
  reminderDate: string;
  usageDeadline: string;
}

export interface BalanceReminderRunResult {
  runAt: string;
  referencePeriod: string | null;
  deadline: ReminderDeadline | null;
  afterPeriodEnd: boolean;
  periodClosed: boolean;
  eligibleEmployees: Array<{ employeeId: number; potentialDays: number }>;
  remindersCreated: number;
  recapRecipients: number;
  recapNotificationsCreated: number;
  errors: string[];
}

@Injectable()
export class BalanceReminderService {
  private readonly logger = new Logger(BalanceReminderService.name);

  constructor(
    @InjectRepository(LeaveBalance)
    private readonly balanceRepository: Repository<LeaveBalance>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async runIfDue(
    now: Date = new Date(),
  ): Promise<BalanceReminderRunResult> {
    const result: BalanceReminderRunResult = {
      runAt: now.toISOString(),
      referencePeriod: null,
      deadline: null,
      afterPeriodEnd: false,
      periodClosed: false,
      eligibleEmployees: [],
      remindersCreated: 0,
      recapRecipients: 0,
      recapNotificationsCreated: 0,
      errors: [],
    };

    try {
      const today = this.martiniqueDateString(now);
      const startMonthDay = await this.settingsService.getString(
        'REFERENCE_PERIOD_START',
        '06-01',
      );
      const period = currentReferencePeriod(today, startMonthDay);
      const endDate = referencePeriodEndDate(period, startMonthDay);
      const closedMarker = await this.settingsService.getValue(
        this.closureMarkerKey(period),
      );

      result.referencePeriod = period;
      result.periodClosed = closedMarker !== null;
      result.afterPeriodEnd = today > endDate;

      if (result.periodClosed || result.afterPeriodEnd) {
        return result;
      }

      const deadlines = reminderDeadlines(period, startMonthDay);
      const due = deadlines.filter((deadline) => deadline.date <= today);

      if (due.length === 0) {
        return result;
      }

      const selected = due[due.length - 1];
      result.deadline = selected;

      const balances = await this.balanceRepository.find({
        where: {
          referencePeriod: period,
          counterType: LeaveBalanceCounterType.N_MINUS_1,
        },
        relations: { employee: { service: true } },
      });

      const eligible: Array<{
        balance: LeaveBalance;
        user: User;
        availableDays: number;
        reservedDays: number;
        potentialDays: number;
      }> = [];

      for (const balance of balances) {
        const user = balance.employee;
        if (!user || !user.isActive || user.role === UserRole.ADMIN) {
          continue;
        }
        const availableDays = this.round(balance.availableDays);
        const reservedDays = this.round(balance.reservedDays);
        const potentialDays = this.round(availableDays - reservedDays);
        if (potentialDays <= 0) {
          continue;
        }
        eligible.push({
          balance,
          user,
          availableDays,
          reservedDays,
          potentialDays,
        });
        result.eligibleEmployees.push({
          employeeId: user.id,
          potentialDays,
        });
      }

      for (const entry of eligible) {
        try {
          const type = balanceReminderType(selected.key, period);
          const exists = await this.notificationsService.alreadyExists({
            userId: entry.user.id,
            type,
            leaveRequestId: null,
          });
          if (exists) {
            continue;
          }

          const payload: BalanceReminderPayload = {
            reminderKey: selected.key,
            referencePeriod: period,
            reminderDate: selected.date,
            usageDeadline: endDate,
            availableDays: entry.availableDays,
            reservedDays: entry.reservedDays,
            potentialDays: entry.potentialDays,
          };

          await this.notificationsService.create({
            userId: entry.user.id,
            channel: NotificationChannel.LES_DEUX,
            type,
            title: this.reminderTitle(endDate),
            message: this.reminderMessage(payload),
          });
          result.remindersCreated += 1;
        } catch (error) {
          this.captureError(result, `Rappel ${entry.user.id}`, error);
        }
      }

      if (eligible.length === 0) {
        return result;
      }

      const rhUsers = await this.userRepository.find({
        where: { role: UserRole.RH, isActive: true },
        select: { id: true },
      });

      if (rhUsers.length === 0) {
        this.logger.warn(
          'Aucun compte RH actif : aucun récapitulatif de fin de période créé.',
        );
        return result;
      }

      const recapType = balanceRecapType(selected.key, period);
      const rows: BalanceRecapRow[] = eligible.map((entry) => ({
        employeeId: entry.user.id,
        nom: entry.user.nom,
        prenom: entry.user.prenom,
        service: entry.user.service?.name ?? '—',
        referencePeriod: period,
        counterType: 'N-1',
        availableDays: entry.availableDays,
        reservedDays: entry.reservedDays,
        potentialDays: entry.potentialDays,
        reminderDate: selected.date,
        usageDeadline: endDate,
      }));
      const recapMessage = this.recapMessage(rows, selected, period, endDate);

      for (const rh of rhUsers) {
        try {
          const exists = await this.notificationsService.alreadyExists({
            userId: rh.id,
            type: recapType,
            leaveRequestId: null,
          });
          if (exists) {
            continue;
          }
          result.recapRecipients += 1;
          await this.notificationsService.create({
            userId: rh.id,
            channel: NotificationChannel.LES_DEUX,
            type: recapType,
            title: `Récapitulatif des congés à utiliser avant le ${formatFrenchDate(endDate)}`,
            message: recapMessage,
          });
          result.recapNotificationsCreated += 1;
        } catch (error) {
          this.captureError(result, `Récapitulatif RH ${rh.id}`, error);
        }
      }

      return result;
    } catch (error) {
      this.captureError(result, 'runIfDue', error);
      return result;
    }
  }

  private reminderTitle(usageDeadline: string): string {
    return `Congés à utiliser avant le ${formatFrenchDate(usageDeadline)}`;
  }

  private reminderMessage(payload: BalanceReminderPayload): string {
    const date = formatFrenchDate(payload.usageDeadline);
    if (payload.reservedDays <= 0) {
      return `Il vous reste ${payload.availableDays} ${this.plural(payload.availableDays, 'jour')} de congés à utiliser avant le ${date}.`;
    }
    return (
      `Il vous reste ${payload.potentialDays} ${this.plural(payload.potentialDays, 'jour')} encore utilisable${payload.potentialDays === 1 ? '' : 's'} ` +
      `sur un solde de ${payload.availableDays} ${this.plural(payload.availableDays, 'jour')}, ` +
      `dont ${payload.reservedDays} ${this.plural(payload.reservedDays, 'jour')} déjà réservé${payload.reservedDays === 1 ? '' : 's'}, ` +
      `à utiliser avant le ${date}.`
    );
  }

  private recapMessage(
    rows: BalanceRecapRow[],
    deadline: ReminderDeadline,
    period: string,
    usageDeadline: string,
  ): string {
    const date = formatFrenchDate(usageDeadline);
    const lines = rows.map((row) => {
      const reserved =
        row.reservedDays === 0
          ? 'aucun jour réservé'
          : `${row.reservedDays} ${this.plural(row.reservedDays, 'jour')} déjà réservé${row.reservedDays === 1 ? '' : 's'}`;
      return (
        `• ${row.prenom} ${row.nom} (${row.service}) — employé n°${row.employeeId} : ` +
        `solde ${row.availableDays} ${this.plural(row.availableDays, 'jour')} (${reserved}, ` +
        `${row.potentialDays} encore utilisable${row.potentialDays === 1 ? '' : 's'})`
      );
    });
    return [
      `Rappel ${reminderDeadlineLabel(deadline.key)} — période ${period} (compteur N-1), congés à utiliser avant le ${date}.`,
      ...lines,
      `${rows.length} ${this.plural(rows.length, 'collaborateur')} concerné${rows.length === 1 ? '' : 's'}.`,
    ].join('\n');
  }

  private closureMarkerKey(referencePeriod: string): string {
    return `REFERENCE_PERIOD_CLOSED_${referencePeriod.replace('-', '_')}`;
  }

  private martiniqueDateString(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Martinique',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: string) =>
      parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private plural(value: number, singular: string): string {
    return value === 1 ? singular : `${singular}s`;
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private captureError(
    result: BalanceReminderRunResult,
    context: string,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`${context} : ${message}`);
    this.logger.error(
      `Rappels de fin de période (${context}) : ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
