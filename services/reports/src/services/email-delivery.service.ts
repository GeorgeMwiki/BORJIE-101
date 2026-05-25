/**
 * Email Delivery Service for Reports
 */

import nodemailer from 'nodemailer';

export interface EmailDeliveryOptions {
  to: string[];
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export class EmailDeliveryService {
  constructor(private readonly transport: nodemailer.Transporter) {}

  async sendReport(options: EmailDeliveryOptions): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      to: options.to.join(', '),
      subject: options.subject,
      text: options.body,
      html: options.body.replace(/\n/g, '<br>'),
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    };
    await this.transport.sendMail(mailOptions);
  }

  static createTransporter(config?: nodemailer.TransportOptions): nodemailer.Transporter {
    if (!config && process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) {
      // SMTP_HOST silently defaulting to localhost in production would
      // route customer-facing report emails into the void.
      throw new Error('SMTP_HOST is required in production (no silent "localhost" default)');
    }
    return nodemailer.createTransport(config ?? {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
  }
}
