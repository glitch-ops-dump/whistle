import { z } from "zod";

export const patchCategorySchema = z.object({
  enabled: z.boolean().optional(),
  sensitivity: z.enum(["public_aggregate", "identity_masked", "protected"]).optional(),
});

export const patchSlaPolicySchema = z.object({
  durationDays: z.number().int().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
});

export const patchCategoryReadinessSchema = z.object({
  primaryOwner: z.string().trim().min(2).max(180).optional(),
  slaSummary: z.string().trim().min(2).max(220).optional(),
  escalationPath: z.string().trim().min(2).max(240).optional(),
  roleAccess: z.array(z.string().trim().min(2).max(80)).min(1).max(8).optional(),
  publicVisibility: z.string().trim().min(2).max(220).optional(),
  privacyLevel: z.enum(["public_aggregate", "identity_masked", "protected"]).optional(),
  sopStatus: z.enum(["approved", "scheduled", "required"]).optional(),
  trainingStatus: z.enum(["approved", "scheduled", "required"]).optional(),
  launchState: z.enum(["ready", "pilot_only", "blocked"]).optional(),
  notes: z.string().trim().min(2).max(500).optional(),
});

export const patchAppControlSchema = z.object({
  value: z.union([z.string().trim().min(1).max(1000), z.boolean(), z.number().int().min(0).max(365)]),
});

export const configChangeTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("category"),
    id: z.enum([
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
    ]),
    patch: patchCategorySchema,
  }),
  z.object({
    kind: z.literal("sla_policy"),
    stage: z.enum(["verification", "local", "ministry", "cm_cell", "rejection_review"]),
    patch: patchSlaPolicySchema,
  }),
  z.object({
    kind: z.literal("category_readiness"),
    categoryId: z.enum([
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
    ]),
    patch: patchCategoryReadinessSchema,
  }),
  z.object({
    kind: z.literal("app_control"),
    id: z.string().trim().min(2).max(120),
    value: patchAppControlSchema.shape.value,
  }),
]);

export const createConfigChangeRequestSchema = z.object({
  target: configChangeTargetSchema,
  reason: z.string().trim().min(10).max(1200),
});

export const decideConfigChangeRequestSchema = z.object({
  reason: z.string().trim().min(6).max(1200),
});

export const auditExportQuerySchema = z.object({
  ticketId: z.string().trim().min(4).max(80).optional(),
});
