import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  /**
   * Test a Slack webhook URL by sending a test message
   */
  async testWebhook(webhookUrl: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'ShipSec test message — your Slack webhook is configured correctly.',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Webhook test failed: ${response.status} ${errorText}`);
        return {
          ok: false,
          error: `Webhook returned status ${response.status}: ${errorText}`,
        };
      }

      return { ok: true };
    } catch (error) {
      this.logger.error('Network error testing webhook:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown network error',
      };
    }
  }

  /**
   * Test a Slack bot token via auth.test. Returns workspace info.
   */
  async authTest(
    botToken: string,
  ): Promise<{ ok: boolean; error?: string; teamName?: string; teamId?: string; url?: string }> {
    try {
      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data: any = await response.json();

      if (!data.ok) {
        this.logger.error(`Slack auth.test failed: ${data.error}`);
        return { ok: false, error: data.error || 'auth.test failed' };
      }

      return {
        ok: true,
        teamName: data.team,
        teamId: data.team_id,
        url: data.url,
      };
    } catch (error) {
      this.logger.error('Network error calling auth.test:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown network error',
      };
    }
  }

  /**
   * Fetch workspace info (name + icon) via team.info. Requires team:read scope.
   */
  async getTeamInfo(
    botToken: string,
  ): Promise<{ ok: boolean; icon?: string; name?: string; id?: string }> {
    try {
      const response = await fetch('https://slack.com/api/team.info', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${botToken}`,
        },
      });

      const data: any = await response.json();

      if (!data.ok) {
        this.logger.warn(`Slack team.info failed: ${data.error}`);
        return { ok: false };
      }

      // Pick the largest available icon (image_230 > image_132 > image_88 > image_68)
      const icons = data.team?.icon ?? {};
      const icon =
        icons.image_230 || icons.image_132 || icons.image_88 || icons.image_68 || icons.image_44;

      return {
        ok: true,
        icon: icons.image_default ? undefined : icon,
        name: data.team?.name,
        id: data.team?.id,
      };
    } catch (error) {
      this.logger.warn('Failed to fetch team.info (non-critical):', error);
      return { ok: false };
    }
  }

  /**
   * List Slack channels using a bot token
   */
  async listChannels(botToken: string): Promise<{ channels: { id: string; name: string }[] }> {
    try {
      const response = await fetch('https://slack.com/api/conversations.list', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data: any = await response.json();

      if (!data.ok) {
        this.logger.error(`Slack API error: ${data.error}`);
        throw new Error(data.error || 'Failed to list channels');
      }

      const channels = (data.channels || []).map((channel: any) => ({
        id: channel.id,
        name: channel.name,
      }));

      return { channels };
    } catch (error) {
      this.logger.error('Error listing Slack channels:', error);
      throw error;
    }
  }

  /**
   * Send a message to a Slack channel using a bot token
   */
  async sendMessage(
    botToken: string,
    channel: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string; ts?: string }> {
    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          text,
        }),
      });

      const data: any = await response.json();

      if (!data.ok) {
        this.logger.error(`Failed to send message: ${data.error}`);
        return {
          ok: false,
          error: data.error || 'Failed to send message',
        };
      }

      return {
        ok: true,
        ts: data.ts,
      };
    } catch (error) {
      this.logger.error('Network error sending message:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown network error',
      };
    }
  }
}
