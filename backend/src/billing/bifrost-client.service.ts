import { Injectable, Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Bifrost Governance API response types
// ---------------------------------------------------------------------------

interface BifrostBudget {
  id: string;
  max_limit: number;
  reset_duration: string;
  calendar_aligned?: boolean;
  current_usage: number;
  last_reset: string;
}

interface BifrostTeam {
  id: string;
  name: string;
  budget_id?: string;
  budget?: BifrostBudget;
  customer_id?: string;
}

interface BifrostTeamResponse {
  message?: string;
  team: BifrostTeam;
}

interface BifrostTeamsListResponse {
  teams: BifrostTeam[];
  count: number;
  total_count: number;
}

interface BifrostVirtualKey {
  id: string;
  name: string;
  value: string;
  is_active: boolean;
  team_id?: string;
}

interface BifrostVirtualKeyResponse {
  message?: string;
  virtual_key: BifrostVirtualKey;
}

@Injectable()
export class BifrostClientService {
  private readonly logger = new Logger(BifrostClientService.name);
  private readonly proxyUrl: string | undefined;
  private readonly masterKey: string | undefined;

  /** Cache: team name → team UUID (Bifrost uses UUIDs internally) */
  private readonly teamIdCache = new Map<string, string>();

  constructor() {
    this.proxyUrl = process.env.BIFROST_PROXY_URL?.trim();
    this.masterKey = process.env.BIFROST_MASTER_KEY?.trim();
  }

  get isConfigured(): boolean {
    // Bifrost governance API may not require a master key (open by default).
    // Require at least the proxy URL to be set.
    return Boolean(this.proxyUrl);
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    if (!this.proxyUrl) {
      throw new Error('Bifrost proxy not configured');
    }

    const url = `${this.proxyUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) ?? {}),
    };
    if (this.masterKey) {
      headers['Authorization'] = `Bearer ${this.masterKey}`;
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Bifrost ${path} returned ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  // ---------------------------------------------------------------------------
  // Team management — /api/governance/teams
  // ---------------------------------------------------------------------------

  /**
   * Create or update a Bifrost team for an organization.
   * Sets the monthly budget to match the subscription plan.
   */
  async ensureTeam(orgId: string, maxBudgetUsd: number): Promise<void> {
    if (!this.isConfigured) return;

    try {
      // Check if team already exists by name
      const existingTeamId = await this.resolveTeamId(orgId);

      if (existingTeamId) {
        // Update existing team budget
        await this.request(`/api/governance/teams/${existingTeamId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: orgId,
            budget: {
              max_limit: maxBudgetUsd,
              reset_duration: '1M',
              calendar_aligned: true,
            },
          }),
        });
        this.logger.log(`Updated Bifrost team budget for org ${orgId} to $${maxBudgetUsd}`);
      } else {
        // Create new team
        const result = await this.request<BifrostTeamResponse>('/api/governance/teams', {
          method: 'POST',
          body: JSON.stringify({
            name: orgId,
            budget: {
              max_limit: maxBudgetUsd,
              reset_duration: '1M',
              calendar_aligned: true,
            },
          }),
        });
        this.teamIdCache.set(orgId, result.team.id);
        this.logger.log(`Created Bifrost team for org ${orgId} with budget $${maxBudgetUsd}`);
      }
    } catch (error) {
      this.logger.error(`Failed to ensure Bifrost team for ${orgId}: ${error}`);
    }
  }

  /**
   * Generate a virtual key scoped to a team.
   * Returns the key string (sk-bf-...) that can be used as Authorization bearer.
   */
  async generateKey(teamId: string): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('Bifrost proxy not configured');
    }

    // Resolve org name → team UUID
    const bifrostTeamId = await this.resolveTeamId(teamId);
    if (!bifrostTeamId) {
      throw new Error(`Bifrost team not found for org ${teamId}`);
    }

    const result = await this.request<BifrostVirtualKeyResponse>('/api/governance/virtual-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: `${teamId}-key`,
        team_id: bifrostTeamId,
      }),
    });

    return result.virtual_key.value;
  }

  // ---------------------------------------------------------------------------
  // Spend tracking
  // ---------------------------------------------------------------------------

  /**
   * Get total USD spend for a team (org) within a date range.
   * Returns 0 if Bifrost is not configured.
   *
   * Bifrost tracks spend via the budget's `current_usage` field on the team.
   * For now, we return the current budget period usage (not date-range filtered)
   * since Bifrost doesn't expose a date-range spend report API.
   */
  async getTeamSpend(_teamId: string, _startDate: Date, _endDate: Date): Promise<number> {
    if (!this.isConfigured) return 0;

    try {
      const teamInfo = await this.getTeamInfo(_teamId);
      if (teamInfo) {
        return Math.round(teamInfo.spend * 100) / 100;
      }
      return 0;
    } catch (error) {
      this.logger.warn(`Failed to get team spend for ${_teamId}: ${error}`);
      return 0;
    }
  }

  /**
   * Get team info including current spend and budget.
   * Returns null if Bifrost is not configured or team doesn't exist.
   */
  async getTeamInfo(teamName: string): Promise<{ spend: number; maxBudget: number | null } | null> {
    if (!this.isConfigured) return null;

    try {
      const bifrostTeamId = await this.resolveTeamId(teamName);
      if (!bifrostTeamId) return null;

      const result = await this.request<BifrostTeamResponse>(
        `/api/governance/teams/${bifrostTeamId}`,
      );
      const budget = result.team.budget;
      return {
        spend: budget?.current_usage ?? 0,
        maxBudget: budget?.max_limit ?? null,
      };
    } catch (error) {
      this.logger.warn(`Failed to get team info for ${teamName}: ${error}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Resolve an org name to a Bifrost team UUID.
   * Bifrost uses UUIDs internally; we use org names as team names.
   */
  private async resolveTeamId(orgName: string): Promise<string | null> {
    const cached = this.teamIdCache.get(orgName);
    if (cached) return cached;

    try {
      const list = await this.request<BifrostTeamsListResponse>(`/api/governance/teams?limit=100`);
      // Cache all teams and find the matching one
      for (const team of list.teams) {
        this.teamIdCache.set(team.name, team.id);
      }
      return this.teamIdCache.get(orgName) ?? null;
    } catch {
      return null;
    }
  }
}
