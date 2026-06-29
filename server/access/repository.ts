import { DevAccessRepository } from "./devRepository.js";
import { PostgresAccessRepository } from "./postgresRepository.js";
import type {
  AccessSnapshot,
  CreateAccessGrantCommand,
  CreateAccessTeamCommand,
  CreateAccessUserCommand,
  CreateTeamMembershipCommand,
  EffectiveAccess,
  UpdateAccessGrantCommand,
  UpdateAccessTeamCommand,
  UpdateAccessUserCommand,
  UpdateTeamMembershipCommand,
} from "./types.js";

export type AccessRepository = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  getSnapshot(): Promise<AccessSnapshot>;
  getEffectiveAccess(actorKey: string): Promise<EffectiveAccess>;
  createUser(command: CreateAccessUserCommand, actor?: string): Promise<AccessSnapshot["users"][number]>;
  createTeam(command: CreateAccessTeamCommand, actor?: string): Promise<AccessSnapshot["teams"][number]>;
  createMembership(command: CreateTeamMembershipCommand, actor?: string): Promise<AccessSnapshot["memberships"][number]>;
  createGrant(command: CreateAccessGrantCommand, actor?: string): Promise<AccessSnapshot["grants"][number]>;
  updateUser(userId: string, command: UpdateAccessUserCommand, actor?: string): Promise<AccessSnapshot["users"][number] | null>;
  updateTeam(teamId: string, command: UpdateAccessTeamCommand, actor?: string): Promise<AccessSnapshot["teams"][number] | null>;
  updateMembership(membershipId: string, command: UpdateTeamMembershipCommand, actor?: string): Promise<AccessSnapshot["memberships"][number] | null>;
  updateGrant(grantId: string, command: UpdateAccessGrantCommand, actor?: string): Promise<AccessSnapshot["grants"][number] | null>;
  close(): Promise<void>;
};

export function createAccessRepository(): AccessRepository {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresAccessRepository(databaseUrl);
  return new DevAccessRepository();
}
