import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect as netConnect, Socket } from 'node:net';
import {
  connect as tlsConnect,
  TLSSocket,
} from 'node:tls';

interface PasswordResetMailInput {
  email: string;
  displayName: string;
  token: string;
  expiresAt: Date;
}

interface SmtpResponse {
  code: number;
  text: string;
}

type SmtpSocket = Socket | TLSSocket;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendPasswordResetEmail(input: PasswordResetMailInput): Promise<void> {
    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL', 'http://localhost:5173')
      .replace(/\/+$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(input.token)}`;

    const host = this.configService.get<string>('MAIL_HOST')?.trim();
    if (!host) {
      this.logDevelopmentResetLink(input, resetUrl);
      return;
    }

    const port = Number(this.configService.get<string>('MAIL_PORT', '587'));
    const secure = this.readBoolean('MAIL_SECURE', port === 465);
    const startTls = !secure && this.readBoolean('MAIL_STARTTLS', true);
    const rejectUnauthorized = this.readBoolean(
      'MAIL_TLS_REJECT_UNAUTHORIZED',
      true,
    );
    const username = this.configService.get<string>('MAIL_USER')?.trim() ?? '';
    const password = this.configService.get<string>('MAIL_PASSWORD') ?? '';
    const from =
      this.configService.get<string>('MAIL_FROM')?.trim() ||
      username ||
      'no-reply@gmes.local';

    const session = await SmtpSession.connect({
      host,
      port,
      secure,
      startTls,
      rejectUnauthorized,
    });

    try {
      await session.authenticate(username, password);
      await session.sendMessage({
        from,
        to: input.email,
        data: this.buildPasswordResetMessage({
          from,
          to: input.email,
          displayName: input.displayName,
          resetUrl,
          expiresAt: input.expiresAt,
        }),
      });
    } finally {
      await session.close();
    }
  }

  private buildPasswordResetMessage(input: {
    from: string;
    to: string;
    displayName: string;
    resetUrl: string;
    expiresAt: Date;
  }): string {
    const boundary = `gmes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const expiry = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'America/Martinique',
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(input.expiresAt);
    const safeName = this.escapeHtml(input.displayName);
    const safeUrl = this.escapeHtml(input.resetUrl);

    const plainText = [
      `Bonjour ${input.displayName},`,
      '',
      'Une demande de réinitialisation du mot de passe de votre compte GMES a été effectuée.',
      `Ouvrez ce lien pour définir un nouveau mot de passe : ${input.resetUrl}`,
      '',
      `Ce lien expire le ${expiry} et ne peut être utilisé qu’une seule fois.`,
      'Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.',
      '',
      'GMES — Gestion des congés et des absences',
    ].join('\r\n');

    const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f4f8fd;font-family:Arial,Helvetica,sans-serif;color:#0b2d59;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8fd;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce7f4;border-radius:18px;overflow:hidden;box-shadow:0 16px 44px rgba(42,72,116,.10);">
            <tr>
              <td style="padding:30px 34px 14px;text-align:center;">
                <div style="font-size:26px;font-weight:800;color:#136bd7;letter-spacing:-.02em;">GMES</div>
                <div style="margin-top:6px;font-size:13px;color:#7187aa;">Gestion des congés et des absences</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 34px 34px;">
                <h1 style="margin:0 0 16px;font-size:25px;line-height:1.2;color:#082b57;">Réinitialisation de votre mot de passe</h1>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#466189;">Bonjour ${safeName},</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#466189;">Une demande de réinitialisation du mot de passe de votre compte GMES a été effectuée.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
                  <tr>
                    <td style="border-radius:10px;background:#ff7412;box-shadow:0 8px 18px rgba(249,115,22,.22);">
                      <a href="${safeUrl}" style="display:inline-block;padding:15px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Réinitialiser mon mot de passe</a>
                    </td>
                  </tr>
                </table>
                <div style="padding:14px 16px;border:1px solid #d7e7fa;border-radius:10px;background:#f7fbff;font-size:13px;line-height:1.55;color:#58739a;">
                  Ce lien expire le <strong>${expiry}</strong> et ne peut être utilisé qu’une seule fois.
                </div>
                <p style="margin:20px 0 0;font-size:12px;line-height:1.55;color:#8a9db9;">Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail. Votre mot de passe actuel reste inchangé.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    return [
      `From: ${input.from}`,
      `To: ${input.to}`,
      'Subject: GMES - Reinitialisation de votre mot de passe',
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      plainText,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');
  }

  private logDevelopmentResetLink(
    input: PasswordResetMailInput,
    resetUrl: string,
  ): void {
    const environment = this.configService.get<string>('NODE_ENV', 'development');
    if (environment === 'production') {
      this.logger.error(
        'MAIL_HOST est absent : l’e-mail de réinitialisation ne peut pas être envoyé.',
      );
      return;
    }

    this.logger.warn(
      [
        'Serveur SMTP non configuré. Lien de réinitialisation disponible uniquement pour le développement :',
        `Utilisateur : ${input.displayName}`,
        `E-mail : ${input.email}`,
        `Lien : ${resetUrl}`,
        `Expiration : ${input.expiresAt.toISOString()}`,
      ].join('\n'),
    );
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const value = this.configService.get<string>(key);
    if (value === undefined || value === null || value.trim() === '') {
      return fallback;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}

class SmtpSession {
  private constructor(
    private socket: SmtpSocket,
    private readonly host: string,
    private readonly rejectUnauthorized: boolean,
  ) {}

  static async connect(options: {
    host: string;
    port: number;
    secure: boolean;
    startTls: boolean;
    rejectUnauthorized: boolean;
  }): Promise<SmtpSession> {
    const socket = options.secure
      ? await SmtpSession.openTlsSocket(options)
      : await SmtpSession.openPlainSocket(options.host, options.port);
    const session = new SmtpSession(
      socket,
      options.host,
      options.rejectUnauthorized,
    );

    await session.expect([220]);
    await session.command(`EHLO ${SmtpSession.clientName()}`, [250]);

    if (options.startTls) {
      await session.command('STARTTLS', [220]);
      session.socket = await session.upgradeToTls();
      await session.command(`EHLO ${SmtpSession.clientName()}`, [250]);
    }

    return session;
  }

  async authenticate(username: string, password: string): Promise<void> {
    if (!username) {
      return;
    }

    await this.command('AUTH LOGIN', [334]);
    await this.command(Buffer.from(username).toString('base64'), [334]);
    await this.command(Buffer.from(password).toString('base64'), [235]);
  }

  async sendMessage(input: {
    from: string;
    to: string;
    data: string;
  }): Promise<void> {
    const fromAddress = SmtpSession.extractAddress(input.from);
    await this.command(`MAIL FROM:<${fromAddress}>`, [250]);
    await this.command(`RCPT TO:<${input.to}>`, [250, 251]);
    await this.command('DATA', [354]);

    const escapedData = input.data
      .replace(/\r?\n/g, '\r\n')
      .replace(/^\./gm, '..');
    const responsePromise = this.readResponse();
    this.socket.write(`${escapedData}\r\n.\r\n`);
    const response = await responsePromise;
    this.ensureExpected(response, [250]);
  }

  async close(): Promise<void> {
    if (this.socket.destroyed) {
      return;
    }

    try {
      await this.command('QUIT', [221]);
    } catch {
      // La fermeture du serveur peut arriver avant la réponse QUIT.
    } finally {
      this.socket.end();
    }
  }

  private async upgradeToTls(): Promise<TLSSocket> {
    const currentSocket = this.socket;
    return new Promise<TLSSocket>((resolve, reject) => {
      const tlsSocket = tlsConnect({
        socket: currentSocket as Socket,
        servername: this.host,
        rejectUnauthorized: this.rejectUnauthorized,
      });
      tlsSocket.once('secureConnect', () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    });
  }

  private async command(command: string, expectedCodes: number[]): Promise<SmtpResponse> {
    const responsePromise = this.readResponse();
    this.socket.write(`${command}\r\n`);
    const response = await responsePromise;
    this.ensureExpected(response, expectedCodes);
    return response;
  }

  private async expect(expectedCodes: number[]): Promise<SmtpResponse> {
    const response = await this.readResponse();
    this.ensureExpected(response, expectedCodes);
    return response;
  }

  private readResponse(): Promise<SmtpResponse> {
    return new Promise<SmtpResponse>((resolve, reject) => {
      let buffer = '';

      const cleanup = () => {
        this.socket.off('data', onData);
        this.socket.off('error', onError);
        this.socket.off('close', onClose);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('La connexion SMTP a été fermée prématurément.'));
      };

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const finalLine = [...lines]
          .reverse()
          .find((line) => /^\d{3} /.test(line));

        if (!finalLine) {
          return;
        }

        cleanup();
        resolve({
          code: Number(finalLine.slice(0, 3)),
          text: lines.join('\n'),
        });
      };

      this.socket.on('data', onData);
      this.socket.once('error', onError);
      this.socket.once('close', onClose);
    });
  }

  private ensureExpected(response: SmtpResponse, expectedCodes: number[]): void {
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`Erreur SMTP ${response.code}: ${response.text}`);
    }
  }

  private static openPlainSocket(host: string, port: number): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const socket = netConnect({ host, port });
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  private static openTlsSocket(options: {
    host: string;
    port: number;
    rejectUnauthorized: boolean;
  }): Promise<TLSSocket> {
    return new Promise<TLSSocket>((resolve, reject) => {
      const socket = tlsConnect({
        host: options.host,
        port: options.port,
        servername: options.host,
        rejectUnauthorized: options.rejectUnauthorized,
      });
      socket.once('secureConnect', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  private static extractAddress(value: string): string {
    const match = value.match(/<([^>]+)>/);
    return (match?.[1] ?? value).trim();
  }

  private static clientName(): string {
    return 'gmes.local';
  }
}
