/**
 * Conversation-threads — core types.
 *
 * Mirror the SQL schema in migrations 0200-0204. All identifiers are
 * stable strings (no implicit numeric keys) so the application layer
 * can choose its ID strategy (ULID, KSUID, nanoid).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Channel (re-imported from persona-runtime via a string union — we do
// NOT import the runtime package's enum here to keep this leaf type
// dependency-free).
// ─────────────────────────────────────────────────────────────────────

export const CHANNEL_VALUES = [
  'web',
  'mobile',
  'whatsapp',
  'sms',
  'voice',
] as const;
export type Channel = (typeof CHANNEL_VALUES)[number];

// ─────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────

export const ProjectSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  ownerUserId: z.string().min(1),
  ownerPersonaId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  moduleScope: z.array(z.string()).default([]),
  customInstructions: z.string().optional(),
  memoryScopeId: z.string().optional(),
  pinned: z.boolean().default(false),
  archivedAt: z.date().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

// ─────────────────────────────────────────────────────────────────────
// Threads
// ─────────────────────────────────────────────────────────────────────

export const ThreadSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().optional(),
  ownerUserId: z.string().min(1),
  ownerPersonaId: z.string().min(1),
  moduleId: z.string().optional(),
  title: z.string().default('New conversation'),
  pinned: z.boolean().default(false),
  archivedAt: z.date().optional(),
  forkOfThreadId: z.string().optional(),
  forkOfMessageId: z.string().optional(),
  messageChainRootHash: z.string().optional(),
  lastMessageAt: z.date().optional(),
  retentionPolicyId: z.string().optional(),
  channel: z.enum(CHANNEL_VALUES).default('web'),
  externalChannelSessionId: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

// ─────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  tenantId: z.string().min(1),
  parentMessageId: z.string().optional(),
  role: z.enum(MESSAGE_ROLES),
  contentJsonb: z.record(z.string(), z.unknown()),
  toolCallsJsonb: z.record(z.string(), z.unknown()).optional(),
  artifactRefIds: z.array(z.string()).optional(),
  actionPlanIds: z.array(z.string()).optional(),
  assetRefs: z.array(z.string()).optional(),
  prevHash: z.string().optional(),
  hash: z.string().min(1),
  createdAt: z.date(),
});
export type Message = z.infer<typeof MessageSchema>;

// ─────────────────────────────────────────────────────────────────────
// Artifacts
// ─────────────────────────────────────────────────────────────────────

export const ARTIFACT_TYPES = [
  'doc',
  'chart',
  'table',
  'form',
  'kpi',
  'deck_slide',
  'image',
  'code',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  tenantId: z.string().min(1),
  artifactType: z.enum(ARTIFACT_TYPES),
  version: z.number().int().min(1),
  parentVersionId: z.string().optional(),
  contentJsonb: z.record(z.string(), z.unknown()),
  title: z.string().optional(),
  createdAt: z.date().optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// ─────────────────────────────────────────────────────────────────────
// Pins
// ─────────────────────────────────────────────────────────────────────

export const PinSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  tenantId: z.string().min(1),
  assetId: z.string().optional(),
  url: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.date().optional(),
});
export type Pin = z.infer<typeof PinSchema>;

// ─────────────────────────────────────────────────────────────────────
// Retention policy (referenced by thread)
// ─────────────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  readonly id: string;
  readonly maxAgeDays?: number;
  readonly maxMessages?: number;
}
