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

      const data = await response.json();

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

      const data = await response.json();

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
