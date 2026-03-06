import { Injectable, Logger } from '@nestjs/common';

interface LiteLLMTeamSpendReport {
  group_by_day: {
    date: string;
    teams: {
      team_name: string;
      total_spend: number;
    }[];
  }[];
}

interface LiteLLMTeamInfo {
  team_id: string;
  spend: number;
  max_budget: number | null;
}

interface LiteLLMTeamInfoResponse {
  team_id?: string;
  spend?: number;
  max_budget?: number | null;
  team_info?: LiteLLMTeamInfo;
}

@Injectable()
export class LiteLLMClientService {
  private readonly logger = new Logger(LiteLLMClientService.name);
  private readonly proxyUrl: string | undefined;
  private readonly masterKey: string | undefined;
  private readonly allowTeamInfoSpendFallback: boolean;

  constructor() {
    this.proxyUrl = process.env.LITELLM_PROXY_URL?.trim();
    this.masterKey = process.env.LITELLM_MASTER_KEY?.trim();
    this.allowTeamInfoSpendFallback =
      process.env.LITELLM_ALLOW_TEAM_INFO_SPEND_FALLBACK?.trim().toLowerCase() === 'true';
  }

  get isConfigured(): boolean {
    return Boolean(this.proxyUrl && this.masterKey);
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    if (!this.proxyUrl || !this.masterKey) {
      throw new Error('LiteLLM proxy not configured');
    }

    const url = `${this.proxyUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.masterKey}`,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LiteLLM ${path} returned ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Get total USD spend for a team (org) within a date range.
   * Returns 0 if LiteLLM is not configured.
   */
  async getTeamSpend(teamId: string, startDate: Date, endDate: Date): Promise<number> {
    if (!this.isConfigured) return 0;

    try {
      return await this.getPeriodTeamSpend(teamId, startDate, endDate);
    } catch (error) {
      if (this.canUseTeamInfoSpendFallback(startDate, endDate, error)) {
        const teamInfo = await this.getTeamInfo(teamId);
        if (teamInfo) {
          this.logger.warn(
            `Falling back to cumulative /team/info spend for ${teamId} because /global/spend/report is unavailable in this environment`,
          );
          return Math.round(teamInfo.spend * 100) / 100;
        }
      }

      this.logger.warn(`Failed to get team spend for ${teamId}: ${error}`);
      return 0;
    }
  }

  private async getPeriodTeamSpend(
    teamId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];

    const report = await this.request<LiteLLMTeamSpendReport>(
      `/global/spend/report?group_by=team&start_date=${start}&end_date=${end}`,
    );

    let totalSpend = 0;
    for (const day of report.group_by_day ?? []) {
      for (const team of day.teams ?? []) {
        if (team.team_name === teamId) {
          totalSpend += team.total_spend;
        }
      }
    }

    return Math.round(totalSpend * 100) / 100; // round to cents
  }

  private canUseTeamInfoSpendFallback(startDate: Date, endDate: Date, error: unknown): boolean {
    if (!this.allowTeamInfoSpendFallback) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error ?? '');
    if (!message.includes('/spend/report endpoint')) {
      return false;
    }

    const now = new Date();
    const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const currentEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    return (
      startDate.getTime() === currentStart.getTime() && endDate.getTime() === currentEnd.getTime()
    );
  }

  /**
   * Get team info including current spend and budget.
   * Returns null if LiteLLM is not configured or team doesn't exist.
   */
  async getTeamInfo(teamId: string): Promise<{ spend: number; maxBudget: number | null } | null> {
    if (!this.isConfigured) return null;

    try {
      const info = await this.request<LiteLLMTeamInfoResponse>(
        `/team/info?team_id=${encodeURIComponent(teamId)}`,
      );
      const normalized = info.team_info ?? info;
      return {
        spend: normalized.spend ?? 0,
        maxBudget: normalized.max_budget ?? null,
      };
    } catch (error) {
      this.logger.warn(`Failed to get team info for ${teamId}: ${error}`);
      return null;
    }
  }

  /**
   * Generate a virtual key scoped to a team.
   * Returns the key string (sk-...) that can be used as Authorization bearer.
   */
  async generateKey(teamId: string): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('LiteLLM proxy not configured');
    }

    const result = await this.request<{ key: string }>('/key/generate', {
      method: 'POST',
      body: JSON.stringify({ team_id: teamId }),
    });

    return result.key;
  }

  /**
   * Create or update a LiteLLM team for an organization.
   * Sets the monthly budget to match the subscription plan.
   */
  async ensureTeam(orgId: string, maxBudgetUsd: number): Promise<void> {
    if (!this.isConfigured) return;

    try {
      // Try to create; if it already exists LiteLLM returns 400 with "team already exists"
      await this.request('/team/new', {
        method: 'POST',
        body: JSON.stringify({
          team_id: orgId,
          max_budget: maxBudgetUsd,
          budget_duration: 'monthly',
        }),
      });
      this.logger.log(`Created LiteLLM team for org ${orgId} with budget $${maxBudgetUsd}`);
    } catch (_error) {
      // Team likely already exists — update budget instead
      try {
        await this.request('/team/update', {
          method: 'POST',
          body: JSON.stringify({
            team_id: orgId,
            max_budget: maxBudgetUsd,
            budget_duration: 'monthly',
          }),
        });
        this.logger.log(`Updated LiteLLM team budget for org ${orgId} to $${maxBudgetUsd}`);
      } catch (updateError) {
        this.logger.error(`Failed to ensure LiteLLM team for ${orgId}: ${updateError}`);
      }
    }
  }
}
