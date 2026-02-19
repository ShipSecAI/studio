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

@Injectable()
export class LiteLLMClientService {
  private readonly logger = new Logger(LiteLLMClientService.name);
  private readonly proxyUrl: string | undefined;
  private readonly masterKey: string | undefined;

  constructor() {
    this.proxyUrl = process.env.LITELLM_PROXY_URL?.trim();
    this.masterKey = process.env.LITELLM_MASTER_KEY?.trim();
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
    } catch (error) {
      this.logger.warn(`Failed to get team spend for ${teamId}: ${error}`);
      return 0;
    }
  }

  /**
   * Get team info including current spend and budget.
   * Returns null if LiteLLM is not configured or team doesn't exist.
   */
  async getTeamInfo(teamId: string): Promise<{ spend: number; maxBudget: number | null } | null> {
    if (!this.isConfigured) return null;

    try {
      const info = await this.request<LiteLLMTeamInfo>(
        `/team/info?team_id=${encodeURIComponent(teamId)}`,
      );
      return { spend: info.spend, maxBudget: info.max_budget };
    } catch (error) {
      this.logger.warn(`Failed to get team info for ${teamId}: ${error}`);
      return null;
    }
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
