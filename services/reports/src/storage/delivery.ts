/**
 * Report delivery - Email delivery of reports
 */

import nodemailer from 'nodemailer';
import type { ReportFormat } from '../reports/report-types.js';
import type { StoredReport } from './storage.js';

export interface DeliveryOptions {
  to: string[];
  subject: string;
  body: string;
  report: StoredReport;
  content: Buffer;
}

export interface IDeliveryService {
  deliverReport(options: DeliveryOptions): Promise<void>;
}

export class EmailDeliveryService implements IDeliveryService {
  constructor(private readonly transport: nodemailer.Transporter) {}

  async deliverReport(options: DeliveryOptions): Promise<void> {
    const ext =
      options.report.format === 'csv'
        ? 'csv'
        : options.report.format === 'excel'
          ? 'xlsx'
          : 'pdf';
    const contentType =
      options.report.format === 'csv'
        ? 'text/csv'
        : options.report.format === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf';

    const mailOptions: nodemailer.SendMailOptions = {
      to: options.to.join(', '),
      subject: options.subject,
      text: options.body,
      html: options.body.replace(/\n/g, '<br>'),
      attachments: [
        {
          filename: options.report.filename,
          content: options.content,
          contentType,
        },
      ],
    };

    await this.transport.sendMail(mailOptions);
  }

  static createTransporter(
    config?: nodemailer.TransportOptions
  ): nodemailer.Transporter {
    if (!config && process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) {
      // SMTP_HOST silently defaulting to localhost in production would
      // route customer-facing report emails into the void.
      throw new Error('SMTP_HOST is required in production (no silent "localhost" default)');
    }
    return nodemailer.createTransport(
      config ?? {
        host: process.env.SMTP_HOST ?? 'localhost',
        port: parseInt(process.env.SMTP_PORT ?? '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth:
          process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              }
            : undefined,
      }
    );
  }
}

export function getReportSubject(
  reportType: string,
  format: ReportFormat
): string {
  const typeLabels: Record<string, string> = {
    financial: 'Financial Report',
    occupancy: 'Occupancy Report',
    maintenance: 'Maintenance Report',
    tenant: 'Tenant Report',
    property: 'Property Report',
  };
  const typeLabel = typeLabels[reportType] ?? reportType;
  return `BORJIE - ${typeLabel} (${format.toUpperCase()})`;
}
