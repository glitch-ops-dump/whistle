import { z } from "zod";
import { isEvidenceFileAllowed } from "../evidence/policy.js";

export const categorySchema = z.enum([
  "corruption",
  "roads",
  "water",
  "power",
  "sanitation",
  "safety",
  "health",
  "education",
  "revenue",
  "ration",
  "other",
]);

const evidenceFileSchema = z
  .object({
    fileName: z.string().trim().min(1).max(180),
    mimeType: z.string().trim().min(3).max(120),
    sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  })
  .refine(isEvidenceFileAllowed, {
    message: "Evidence file type or filename is not allowed.",
  });

export const createTicketSchema = z.object({
  category: categorySchema,
  language: z.enum(["en", "ta"]).default("en"),
  title: z.string().trim().min(6).max(120),
  description: z.string().trim().min(20).max(4000),
  phone: z.string().trim().min(10).max(24),
  phoneVerificationToken: z.string().trim().min(12).max(120).optional(),
  reference: z.string().trim().max(140).optional(),
  departmentHint: z.string().trim().max(160).optional(),
  location: z.object({
    district: z.string().trim().min(2).max(80),
    area: z.string().trim().min(2).max(160),
    address: z.string().trim().max(240).optional(),
    landmark: z.string().trim().max(160).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }),
  evidence: z.array(evidenceFileSchema).max(8).default([]),
});

export const evidenceUploadSchema = evidenceFileSchema.extend({
  actor: z.string().trim().min(2).max(120).optional(),
});

export const evidenceUploadCompletionSchema = z.object({
  actor: z.string().trim().min(2).max(120).optional(),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  checksum: z.string().trim().min(12).max(160),
});

export const citizenUpdateSchema = z.object({
  actor: z.string().trim().min(2).max(120).optional(),
  details: z.string().trim().min(12).max(1200),
  address: z.string().trim().min(6).max(240).optional(),
  evidence: z.array(evidenceFileSchema).max(8).default([]),
});

export const fieldEvidenceSchema = evidenceFileSchema.extend({
  label: z.enum(["before", "after", "field_report", "closure"]).optional(),
});

export const closureChecklistSchema = z.object({
  fieldVisitCompleted: z.boolean(),
  evidenceAttached: z.boolean(),
  citizenImpactChecked: z.boolean(),
  safetyRiskClosed: z.boolean(),
});

export const fieldExecutionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("schedule_visit"),
    actor: z.string().trim().min(2).max(120).default("field:prototype"),
    fieldOfficer: z.string().trim().min(2).max(160),
    visitAt: z.string().datetime(),
    note: z.string().trim().min(6).max(1000),
  }),
  z.object({
    action: z.literal("add_field_report"),
    actor: z.string().trim().min(2).max(120).default("field:prototype"),
    fieldOfficer: z.string().trim().min(2).max(160),
    note: z.string().trim().min(6).max(1400),
    evidence: z.array(fieldEvidenceSchema).max(8).default([]),
  }),
  z.object({
    action: z.literal("transfer"),
    actor: z.string().trim().min(2).max(120).default("field:prototype"),
    reason: z.string().trim().min(10).max(800),
    ownerKey: z.string().trim().min(2).max(120),
    ownerLabel: z.string().trim().min(2).max(160),
    scopeKind: z.enum(["district", "constituency", "ward", "ministry"]),
    scopeValue: z.string().trim().min(2).max(160),
    queueKind: z.enum(["local", "mla", "ministry"]),
  }),
  z.object({
    action: z.literal("resolve"),
    actor: z.string().trim().min(2).max(120).default("field:prototype"),
    resolutionNote: z.string().trim().min(12).max(1400),
    checklist: closureChecklistSchema,
    evidence: z.array(fieldEvidenceSchema).max(8).default([]),
  }),
]);

export const citizenDisputeSchema = z.object({
  actor: z.string().trim().min(2).max(120).optional(),
  reason: z.string().trim().min(12).max(1400),
  evidence: z.array(fieldEvidenceSchema).max(8).default([]),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  cursor: z.string().trim().min(8).max(800).optional(),
});

export const citizenTicketsQuerySchema = paginationQuerySchema.extend({
  phone: z.string().trim().min(10).max(24),
});

export const verificationQueueQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
});

export const operationalLogQuerySchema = paginationQuerySchema.extend({
  ticketId: z.string().trim().min(4).max(80).optional(),
});

export const verificationDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request_info"),
    actor: z.string().trim().min(2).max(120).default("verification:demo"),
    reason: z.string().trim().min(4).max(500),
    missingFields: z.array(z.string().trim().min(2).max(80)).min(1).max(8),
    citizenMessage: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("reject"),
    actor: z.string().trim().min(2).max(120).default("verification:demo"),
    reason: z.string().trim().min(4).max(500),
  }),
  z.object({
    action: z.literal("route_local"),
    actor: z.string().trim().min(2).max(120).default("verification:demo"),
    reason: z.string().trim().min(4).max(500),
    ownerKey: z.string().trim().min(2).max(120),
    ownerLabel: z.string().trim().min(2).max(160),
    scopeValue: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal("route_protected"),
    actor: z.string().trim().min(2).max(120).default("verification:demo"),
    reason: z.string().trim().min(4).max(500),
  }),
]);

export const rejectionReviewDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("uphold_rejection"),
    actor: z.string().trim().min(2).max(120).default("cm_cell:prototype"),
    reason: z.string().trim().min(10).max(800),
    closureNote: z.string().trim().min(12).max(1000),
  }),
  z.object({
    action: z.literal("request_info"),
    actor: z.string().trim().min(2).max(120).default("cm_cell:prototype"),
    reason: z.string().trim().min(10).max(800),
    missingFields: z.array(z.string().trim().min(2).max(80)).min(1).max(8),
    citizenMessage: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("overturn_and_route"),
    actor: z.string().trim().min(2).max(120).default("cm_cell:prototype"),
    reason: z.string().trim().min(10).max(800),
    ownerKey: z.string().trim().min(2).max(120),
    ownerLabel: z.string().trim().min(2).max(160),
    scopeValue: z.string().trim().min(2).max(120),
  }),
]);

export const queueKindSchema = z.enum(["citizen", "verification", "protected_review", "rejection_review", "local", "mla", "ministry", "cm_cell"]);

export const govRoleSchema = z.enum(["cm_cell", "minister", "department_officer", "mla", "councillor", "verification", "admin"]);

export const localUatOfficialTokenSchema = z.object({
  actor: z.string().trim().min(2).max(120),
  role: govRoleSchema,
});

export const dashboardFilterSchema = z.object({
  role: govRoleSchema.default("cm_cell"),
  ministry: z.string().trim().min(2).max(160).optional(),
  district: z.string().trim().min(2).max(80).optional(),
  constituency: z.string().trim().min(2).max(160).optional(),
  ward: z.string().trim().min(2).max(160).optional(),
  queue: z.union([queueKindSchema, z.literal("all")]).optional(),
  primaryQueue: z.union([queueKindSchema, z.literal("all")]).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  ticketLimit: z.coerce.number().int().min(1).max(100).default(50),
  ticketOffset: z.coerce.number().int().min(0).max(100_000).default(0),
  ticketCursor: z.string().trim().min(8).max(800).optional(),
});

export const slaJobSchema = z.object({
  actor: z.string().trim().min(2).max(120).default("sla:worker"),
  now: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const evidenceScanJobSchema = z.object({
  actor: z.string().trim().min(2).max(120).default("evidence:scanner"),
  now: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const notificationJobSchema = z.object({
  actor: z.string().trim().min(2).max(120).default("notification:worker"),
  now: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const evidenceAccessQuerySchema = z.object({
  role: z.enum(["citizen", "cm_cell", "minister", "department_officer", "mla", "councillor", "verification", "admin"]).default("citizen"),
  actor: z.string().trim().min(2).max(120).optional(),
  accessReason: z.string().trim().min(8).max(240).optional(),
});
