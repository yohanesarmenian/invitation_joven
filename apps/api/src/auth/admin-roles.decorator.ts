import { SetMetadata } from "@nestjs/common";
import type { AdminRole } from "../generated/prisma/client.js";

export const ADMIN_ALLOWED_ROLES_KEY = "admin:allowed_roles";

export function AdminRoles(...roles: AdminRole[]) {
  return SetMetadata(ADMIN_ALLOWED_ROLES_KEY, roles);
}
