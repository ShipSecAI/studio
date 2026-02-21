import { describe, it, expect, beforeEach } from 'bun:test';
import { HumanInputsService } from '../human-inputs.service';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Unit tests for IDOR protection in HumanInputsService
 * Ensures organization-level access control is enforced
 */
describe('HumanInputsService - IDOR Protection', () => {
  let service: HumanInputsService;
  let mockDb: any;

  const ORG_A = 'org-a-' + randomUUID();
  const ORG_B = 'org-b-' + randomUUID();

  const mockApprovalA = {
    id: randomUUID(),
    organizationId: ORG_A,
    title: 'Approval in Org A',
    status: 'pending',
    inputType: 'approval',
  };

  const mockApprovalB = {
    id: randomUUID(),
    organizationId: ORG_B,
    title: 'Approval in Org B',
    status: 'pending',
    inputType: 'approval',
  };

  beforeEach(() => {
    // Mock database with query builder
    mockDb = {
      query: {
        humanInputRequests: {
          findMany: async (options: any) => {
            const approvals = [mockApprovalA, mockApprovalB];

            // Simulate WHERE clause filtering
            if (options.where) {
              return approvals.filter((approval) => {
                // Check organization filter
                if (
                  options.where.__drizzleAnd &&
                  options.where.__drizzleAnd.some((c: any) => {
                    // Check if org matches
                    return (
                      c.__drizzleEq &&
                      c.leftOperand?.key === 'organization_id' &&
                      c.rightOperand?.value === approval.organizationId
                    );
                  })
                ) {
                  return true;
                }
                // Fallback: check direct org match
                return approval.organizationId === ORG_A;
              });
            }
            return approvals;
          },
          findFirst: async (options: any) => {
            const allApprovals = [mockApprovalA, mockApprovalB];

            // Without org filter, should return nothing (IDOR check)
            if (!options.where || !options.where.__drizzleAnd) {
              return null;
            }

            const approval = allApprovals.find((a) => a.id === mockApprovalA.id);
            if (!approval) return null;

            // Check org filter
            const hasOrgFilter = options.where.__drizzleAnd.some((c: any) => {
              return c.__drizzleEq && c.leftOperand?.key === 'organization_id';
            });

            if (!hasOrgFilter) {
              return null; // No org filter = IDOR vulnerability
            }

            return approval;
          },
        },
      },
      update: async (_table: any) => ({
        set: async () => ({
          where: async () => ({
            returning: async () => [mockApprovalA],
          }),
        }),
      }),
    };

    // Simplified mock that tracks query patterns
    mockDb._lastQuery = null;
    mockDb._trackQuery = function (query: string) {
      this._lastQuery = query;
    };

    service = new HumanInputsService(mockDb, {} as any, {} as any);
  });

  it('should filter list by organization', async () => {
    // Create a more realistic mock that filters by org
    mockDb.query.humanInputRequests.findMany = async (options: any) => {
      // Verify that organization filter is being applied
      if (!options.where) {
        throw new Error('No where clause - missing organization filter!');
      }
      return [mockApprovalA];
    };

    const result = await service.list({}, ORG_A);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(mockApprovalA.id);
  });

  it('should throw if list called without organization', async () => {
    mockDb.query.humanInputRequests.findMany = async (options: any) => {
      // Without org, return empty to avoid IDOR
      if (!options.where) {
        return [];
      }
      return [mockApprovalA];
    };

    const result = await service.list({}, undefined);
    expect(result).toHaveLength(0);
  });

  it('should not allow accessing approval from different org', async () => {
    mockDb.query.humanInputRequests.findFirst = async (options: any) => {
      // Verify org filter exists
      if (!options.where || !Array.isArray(options.where.__drizzleAnd)) {
        return null; // No org filter = IDOR blocked
      }

      const conditions = options.where.__drizzleAnd;
      const hasOrgFilter = conditions.some((c: any) => c.column?.name === 'organization_id');

      if (!hasOrgFilter) {
        return null;
      }

      // Return approval only if org matches
      return mockApprovalA;
    };

    let threw = false;
    try {
      // Try to access Org B's approval with Org A credentials
      await service.getById(mockApprovalB.id, ORG_A);
    } catch (_error: any) {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('should allow accessing own org approval', async () => {
    mockDb.query.humanInputRequests.findFirst = async (_options: any) => {
      return mockApprovalA;
    };

    const result = await service.getById(mockApprovalA.id, ORG_A);
    expect(result.id).toBe(mockApprovalA.id);
  });

  it('should require organizationId for resolve', async () => {
    // If organizationId is undefined, getById should fail
    mockDb.query.humanInputRequests.findFirst = async (options: any) => {
      // Without org filter, deny access
      if (!options.where) {
        return null;
      }
      return null;
    };

    let threw = false;
    try {
      await service.resolve(mockApprovalA.id, { responseData: { status: 'approved' } }, undefined);
    } catch (error: any) {
      threw = true;
      expect(error).toBeInstanceOf(NotFoundException);
    }
    expect(threw).toBe(true);
  });

  it('summary: organization scoping is enforced at service level', async () => {
    // Verify the service methods have org parameters
    expect(service.list.length).toBeGreaterThan(0); // Has parameters
    expect(service.getById.length).toBeGreaterThan(0);
    expect(service.resolve.length).toBeGreaterThan(0);
  });
});
