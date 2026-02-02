import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RequestWithAuthContext } from '../auth/auth.guard';
import type { AuthContext, AuthRole } from '../auth/types';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';

export interface WorkflowRoleRequirement {
  role: AuthRole;
  /**
   * Name of the route parameter that contains the workflow ID.
   * Defaults to `id`.
   */
  param?: string;
  /**
   * When true (default), organization-level admins automatically satisfy the requirement.
   */
  allowOrgAdmins?: boolean;
}

const WORKFLOW_ROLE_KEY = 'shipsec:workflow:role';

export const RequireWorkflowRole = (
  role: AuthRole,
  options: Omit<WorkflowRoleRequirement, 'role'> = {},
) =>
  SetMetadata(WORKFLOW_ROLE_KEY, {
    role,
    param: options.param ?? 'id',
    allowOrgAdmins: options.allowOrgAdmins ?? true,
  } satisfies WorkflowRoleRequirement);

@Injectable()
export class WorkflowRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly workflowRoleRepository: WorkflowRoleRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<WorkflowRoleRequirement | undefined>(
      WORKFLOW_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();
    if (!request?.auth) {
      return false;
    }

    const auth = request.auth;
    if (requirement.allowOrgAdmins !== false && this.isOrganizationAdmin(auth)) {
      return true;
    }

    if (!auth.userId) {
      return false;
    }

    const workflowId = this.resolveWorkflowId(request, requirement.param ?? 'id');
    if (!workflowId) {
      return false;
    }

    return this.workflowRoleRepository.hasRole({
      workflowId,
      userId: auth.userId,
      role: requirement.role,
      organizationId: auth.organizationId ?? undefined,
    });
  }

  private isOrganizationAdmin(auth: AuthContext): boolean {
    return Array.isArray(auth.roles) && auth.roles.includes('ADMIN');
  }

  private resolveWorkflowId(request: RequestWithAuthContext, param: string): string | undefined {
    if (request.params && typeof request.params[param] === 'string') {
      return request.params[param];
    }

    if (request.body && typeof request.body?.workflowId === 'string') {
      return request.body.workflowId;
    }

    if (request.query && typeof request.query?.workflowId === 'string') {
      return request.query.workflowId as string;
    }

    return undefined;
  }
}
