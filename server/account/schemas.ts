import { z } from "zod";
import { govRoleSchema } from "../ticket-spine/schemas.js";

export const authSurfaceSchema = z.enum(["citizen", "government"]);

export const loginSchema = z.object({
  surface: authSurfaceSchema,
  phone: z.string().trim().min(10).max(24),
  password: z.string().min(8).max(120),
  role: govRoleSchema.optional(),
  phoneVerificationToken: z.string().trim().min(12).max(120).optional(),
});

export const citizenRegisterSchema = z.object({
  phone: z.string().trim().min(10).max(24),
  displayName: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(120),
  phoneVerificationToken: z.string().trim().min(12).max(120).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(120),
  newPassword: z.string().min(8).max(120),
});

export const resetPasswordSchema = z.object({
  surface: authSurfaceSchema,
  phone: z.string().trim().min(10).max(24),
  newPassword: z.string().min(8).max(120),
  phoneVerificationToken: z.string().trim().min(12).max(120),
});

export const logoutSchema = z.object({
  sessionToken: z.string().trim().min(16).max(160).optional(),
});
