import { z } from "zod";

export const accessRoleSchema = z.enum(["admin", "cm_cell", "minister", "department_officer", "mla", "councillor", "verification", "worker"]);
export const accessScopeKindSchema = z.enum(["state", "district", "constituency", "ward", "ministry", "protected", "queue", "system"]);

export const createAccessUserSchema = z.object({
  actorKey: z.string().trim().min(3).max(120),
  displayName: z.string().trim().min(2).max(160),
  status: z.enum(["active", "inactive"]).default("active"),
  mfaState: z.enum(["not_required_mvp", "pending", "enabled"]).default("not_required_mvp"),
});

export const createAccessTeamSchema = z.object({
  name: z.string().trim().min(2).max(160),
  role: accessRoleSchema,
  ownerActorKey: z.string().trim().min(3).max(120),
  defaultScopeKind: accessScopeKindSchema,
  defaultScopeValue: z.string().trim().min(2).max(160),
});

export const createTeamMembershipSchema = z.object({
  userId: z.string().trim().min(2).max(120),
  teamId: z.string().trim().min(2).max(120),
  roleLabel: z.string().trim().min(2).max(120),
  expiresAt: z.string().datetime().optional(),
});

export const createAccessGrantSchema = z.object({
  targetType: z.enum(["user", "team"]),
  targetId: z.string().trim().min(2).max(120),
  role: accessRoleSchema,
  scopeKind: accessScopeKindSchema,
  scopeValue: z.string().trim().min(2).max(160),
  protectedAccess: z.boolean().default(false),
  reporterIdentity: z.boolean().default(false),
  actions: z.array(z.string().trim().min(2).max(120)).max(40).default([]),
  expiresAt: z.string().datetime().optional(),
});

export const updateAccessUserSchema = z
  .object({
    status: z.enum(["active", "inactive"]).optional(),
    mfaState: z.enum(["not_required_mvp", "pending", "enabled"]).optional(),
  })
  .refine((value) => value.status !== undefined || value.mfaState !== undefined, {
    message: "At least one user field must be supplied.",
  });

export const updateAccessGrantSchema = z
  .object({
    protectedAccess: z.boolean().optional(),
    reporterIdentity: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (value) => value.protectedAccess !== undefined || value.reporterIdentity !== undefined || Object.hasOwn(value, "expiresAt"),
    {
      message: "At least one grant field must be supplied.",
    },
  );

export const updateAccessTeamSchema = z
  .object({
    status: z.enum(["active", "inactive"]).optional(),
    ownerActorKey: z.string().trim().min(3).max(120).optional(),
    defaultScopeKind: accessScopeKindSchema.optional(),
    defaultScopeValue: z.string().trim().min(2).max(160).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.ownerActorKey !== undefined ||
      value.defaultScopeKind !== undefined ||
      value.defaultScopeValue !== undefined,
    {
      message: "At least one team field must be supplied.",
    },
  )
  .refine((value) => (value.defaultScopeKind === undefined) === (value.defaultScopeValue === undefined), {
    message: "defaultScopeKind and defaultScopeValue must be supplied together.",
  });

export const updateTeamMembershipSchema = z
  .object({
    roleLabel: z.string().trim().min(2).max(120).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => value.roleLabel !== undefined || Object.hasOwn(value, "expiresAt"), {
    message: "At least one membership field must be supplied.",
  });

export const effectiveAccessQuerySchema = z.object({
  actor: z.string().trim().min(3).max(120),
});
