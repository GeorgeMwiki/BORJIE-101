/**
 * Inspections Service
 * Property inspection workflow for move-in, move-out, periodic, maintenance, and pre-listing inspections.
 * Supports photo uploads, e-signatures, and checklist templates per inspection type.
 */

export * from './types.js';
export * from './events.js';
export * from './room-template.js';
export * from './checklist-templates.js';
export * from './inspection-service.js';

// Additive modules (NEW 2, 16, 19)
export * as ConditionalSurvey from './conditional-survey/index.js';
export * as Far from './far/index.js';
export * as MoveOut from './move-out/index.js';
