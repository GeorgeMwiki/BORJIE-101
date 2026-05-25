/**
 * Type declarations for @aws-sdk/client-ses
 * Install with: pnpm add @aws-sdk/client-ses
 */
declare module '@aws-sdk/client-ses' {
  export class SESClient {
    constructor(config?: unknown);
    send(command: unknown): Promise<{ MessageId?: string }>;
  }
  export class SendEmailCommand {
    constructor(input: unknown);
  }
}
