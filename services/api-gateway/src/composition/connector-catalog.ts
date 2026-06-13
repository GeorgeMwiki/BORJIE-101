/**
 * Connector catalog — the declarative half of the universal integration
 * fabric (`connector-fabric.ts`).
 *
 * One row of metadata per dormant connector package under
 * `packages/connectors/<id>/` (the `@borjie/connector-<id>` workspace
 * packages). The packages ship complete OAuth flows, provider clients,
 * ingest pollers and credential repositories — but expose NO unified
 * runtime catalog, so this single frozen array IS the catalog the
 * gateway + brain discover connectors from.
 *
 * THE GENERATIVE RULE: adding a 22nd connector requires exactly ONE new
 * entry here (plus its package). Zero new routes, zero new brain tools —
 * the fabric route (`/integrations/connectors`) and the two brain tools
 * (`integration.connector.list` / `integration.connector.invoke`)
 * dispatch generically over this data.
 *
 * HONESTY RULES baked into the metadata:
 *   - `credentialKinds` lists the `connector_credentials.connector_kind`
 *     values whose presence means "this tenant has connected this
 *     connector". Batch-1 connectors (slack / email / calendar) use the
 *     provider-level kinds their OAuth flows already persist; every
 *     later connector uses its own id (the convention its package's
 *     provider constant follows, e.g. whatsapp PROVIDER = 'whatsapp').
 *   - `actions` only lists capabilities the underlying package actually
 *     implements (ingest sync everywhere; outbound sends only where the
 *     package ships an outbound client). No claimed-but-fake actions.
 */

// ---------- Types ----------

export interface ConnectorActionDescriptor {
  readonly id: string;
  readonly description: string;
  /** True when the action mutates state on the EXTERNAL system (egress write). */
  readonly isWrite: boolean;
}

export type ConnectorCategory =
  | 'communication'
  | 'productivity'
  | 'crm'
  | 'devtools'
  | 'social'
  | 'meetings';

export interface ConnectorDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly category: ConnectorCategory;
  readonly description: string;
  /** Workspace package that implements this connector. */
  readonly packageName: string;
  /**
   * `connector_credentials.connector_kind` values that mark this
   * connector as connected for a tenant.
   */
  readonly credentialKinds: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<ConnectorActionDescriptor>;
}

// ---------- Shared action fragments ----------

const SYNC_PULL: ConnectorActionDescriptor = Object.freeze({
  id: 'sync.pull',
  description:
    'Pull the latest data from the provider into the tenant canonical ' +
    'store (incremental, cursor-based ingest).',
  isWrite: false,
});

const CONNECTION_TEST: ConnectorActionDescriptor = Object.freeze({
  id: 'connection.test',
  description:
    'Probe the stored credentials against the provider (liveness + ' +
    'scope check). Read-only.',
  isWrite: false,
});

const READ_ACTIONS: ReadonlyArray<ConnectorActionDescriptor> = Object.freeze([
  SYNC_PULL,
  CONNECTION_TEST,
]);

const freezeActions = (
  extra: ReadonlyArray<ConnectorActionDescriptor> = [],
): ReadonlyArray<ConnectorActionDescriptor> =>
  Object.freeze([...READ_ACTIONS, ...extra.map((a) => Object.freeze({ ...a }))]);

// ---------- The catalog ----------

export const CONNECTOR_CATALOG: ReadonlyArray<ConnectorDescriptor> =
  Object.freeze(
    (
      [
        {
          id: 'calendar',
          displayName: 'Calendar (Google + Outlook)',
          category: 'productivity',
          description:
            'Google Calendar + Outlook Calendar ingest — events, attendees, recurrences.',
          packageName: '@borjie/connector-calendar',
          credentialKinds: ['google_calendar', 'outlook_calendar'],
          actions: freezeActions(),
        },
        {
          id: 'email',
          displayName: 'Email (Gmail + Outlook)',
          category: 'communication',
          description:
            'Gmail + Outlook mail ingest — label-scoped, attachments, salted-hash redaction.',
          packageName: '@borjie/connector-email',
          credentialKinds: ['gmail', 'outlook_mail'],
          actions: freezeActions(),
        },
        {
          id: 'slack',
          displayName: 'Slack',
          category: 'communication',
          description:
            'Slack ingest (channels, threads, files, reactions) + operator-feed message posting.',
          packageName: '@borjie/connector-slack',
          credentialKinds: ['slack'],
          actions: freezeActions([
            {
              id: 'message.post',
              description:
                'Post a message to a Slack channel in the connected workspace.',
              isWrite: true,
            },
          ]),
        },
        {
          id: 'whatsapp',
          displayName: 'WhatsApp Business',
          category: 'communication',
          // HONESTY (M3): the @borjie/connector-whatsapp package implements
          // ONLY inbound webhook ingest — it ships no outbound-message client.
          // The `message.send` capability previously advertised here was a
          // claimed-but-fake action (no code backs it), so it has been removed
          // to honour the catalog's "no claimed-but-fake actions" rule.
          // Outbound WhatsApp delivery is served separately by the Twilio SMS
          // provider (channel:'whatsapp') wired into the reminders-dispatch +
          // notification-dispatch workers — NOT by this connector package.
          description:
            'WhatsApp Business Cloud API — inbound webhook ingest only ' +
            '(no outbound-message client in this connector).',
          packageName: '@borjie/connector-whatsapp',
          credentialKinds: ['whatsapp'],
          actions: freezeActions(),
        },
        {
          id: 'voice',
          displayName: 'Voice (Twilio)',
          category: 'communication',
          description:
            'Twilio Voice — inbound IVR ingest, outbound notification calls, recordings + transcripts.',
          packageName: '@borjie/connector-voice',
          credentialKinds: ['voice'],
          actions: freezeActions([
            {
              id: 'call.notify',
              description:
                'Place an outbound Twilio notification call to a verified number.',
              isWrite: true,
            },
          ]),
        },
        {
          id: 'teams',
          displayName: 'Microsoft Teams',
          category: 'communication',
          description: 'Microsoft Teams ingest — channels, chats, messages.',
          packageName: '@borjie/connector-teams',
          credentialKinds: ['teams'],
          actions: freezeActions(),
        },
        {
          id: 'google-drive',
          displayName: 'Google Drive',
          category: 'productivity',
          description: 'Google Drive ingest — files, folders, permissions metadata.',
          packageName: '@borjie/connector-google-drive',
          credentialKinds: ['google-drive'],
          actions: freezeActions(),
        },
        {
          id: 'notion',
          displayName: 'Notion',
          category: 'productivity',
          description: 'Notion ingest — pages, databases, blocks.',
          packageName: '@borjie/connector-notion',
          credentialKinds: ['notion'],
          actions: freezeActions(),
        },
        {
          id: 'salesforce',
          displayName: 'Salesforce',
          category: 'crm',
          description: 'Salesforce CRM ingest — accounts, contacts, opportunities.',
          packageName: '@borjie/connector-salesforce',
          credentialKinds: ['salesforce'],
          actions: freezeActions(),
        },
        {
          id: 'hubspot',
          displayName: 'HubSpot',
          category: 'crm',
          description: 'HubSpot CRM ingest — companies, contacts, deals, pipelines.',
          packageName: '@borjie/connector-hubspot',
          credentialKinds: ['hubspot'],
          actions: freezeActions(),
        },
        {
          id: 'github',
          displayName: 'GitHub',
          category: 'devtools',
          description: 'GitHub ingest — repos, issues, pull requests, org activity.',
          packageName: '@borjie/connector-github',
          credentialKinds: ['github'],
          actions: freezeActions(),
        },
        {
          id: 'gitlab',
          displayName: 'GitLab',
          category: 'devtools',
          description: 'GitLab ingest — projects, issues, merge requests.',
          packageName: '@borjie/connector-gitlab',
          credentialKinds: ['gitlab'],
          actions: freezeActions(),
        },
        {
          id: 'jira',
          displayName: 'Jira',
          category: 'devtools',
          description: 'Jira ingest — projects, issues, sprints, workflows.',
          packageName: '@borjie/connector-jira',
          credentialKinds: ['jira'],
          actions: freezeActions(),
        },
        {
          id: 'linear',
          displayName: 'Linear',
          category: 'devtools',
          description: 'Linear ingest — teams, issues, cycles, projects.',
          packageName: '@borjie/connector-linear',
          credentialKinds: ['linear'],
          actions: freezeActions(),
        },
        {
          id: 'zoom',
          displayName: 'Zoom',
          category: 'meetings',
          description: 'Zoom ingest — meetings, recordings, transcripts.',
          packageName: '@borjie/connector-zoom',
          credentialKinds: ['zoom'],
          actions: freezeActions(),
        },
        {
          id: 'facebook',
          displayName: 'Facebook',
          category: 'social',
          description: 'Facebook ingest — pages, posts, comments, insights.',
          packageName: '@borjie/connector-facebook',
          credentialKinds: ['facebook'],
          actions: freezeActions(),
        },
        {
          id: 'instagram',
          displayName: 'Instagram',
          category: 'social',
          description: 'Instagram ingest — media, comments, account insights.',
          packageName: '@borjie/connector-instagram',
          credentialKinds: ['instagram'],
          actions: freezeActions(),
        },
        {
          id: 'linkedin',
          displayName: 'LinkedIn',
          category: 'social',
          description: 'LinkedIn ingest — organisation posts, engagement metrics.',
          packageName: '@borjie/connector-linkedin',
          credentialKinds: ['linkedin'],
          actions: freezeActions(),
        },
        {
          id: 'tiktok',
          displayName: 'TikTok',
          category: 'social',
          description: 'TikTok ingest — videos, comments, account analytics.',
          packageName: '@borjie/connector-tiktok',
          credentialKinds: ['tiktok'],
          actions: freezeActions(),
        },
        {
          id: 'x',
          displayName: 'X (Twitter)',
          category: 'social',
          description: 'X ingest — posts, mentions, direct-message metadata.',
          packageName: '@borjie/connector-x',
          credentialKinds: ['x'],
          actions: freezeActions(),
        },
        {
          id: 'youtube',
          displayName: 'YouTube',
          category: 'social',
          description: 'YouTube ingest — channel videos, comments, analytics.',
          packageName: '@borjie/connector-youtube',
          credentialKinds: ['youtube'],
          actions: freezeActions(),
        },
      ] as const satisfies ReadonlyArray<ConnectorDescriptor>
    ).map((entry) =>
      Object.freeze({
        ...entry,
        credentialKinds: Object.freeze([...entry.credentialKinds]),
        actions: Object.freeze([...entry.actions]),
      }),
    ),
  );

/** Look up a catalog descriptor by id. Returns null for unknown ids. */
export function getConnectorDescriptor(
  connectorId: string,
): ConnectorDescriptor | null {
  return CONNECTOR_CATALOG.find((c) => c.id === connectorId) ?? null;
}
