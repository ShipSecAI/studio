import { Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

export interface SlackPostedMessage {
  ok: boolean;
  error?: string;
  ts?: string;
}

/** Allowed webhook URL hostnames to prevent SSRF. */
const ALLOWED_WEBHOOK_HOSTS = new Set(['hooks.slack.com', 'hooks.slack-gov.com']);

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  /** Create a WebClient for a given bot token. */
  private client(botToken: string): WebClient {
    return new WebClient(botToken);
  }

  /**
   * Validate that a webhook URL points to an allowed Slack domain.
   */
  assertSafeWebhookUrl(webhookUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new Error('Invalid webhook URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new Error('Webhook URL must use HTTPS');
    }

    if (!ALLOWED_WEBHOOK_HOSTS.has(parsed.hostname)) {
      throw new Error(
        `Webhook URL hostname "${parsed.hostname}" is not allowed. Must be one of: ${[...ALLOWED_WEBHOOK_HOSTS].join(', ')}`,
      );
    }
  }

  /**
   * Test a Slack webhook URL by sending a test message.
   * Webhooks don't go through the SDK — they're plain HTTPS POSTs.
   */
  async testWebhook(webhookUrl: string): Promise<{ ok: boolean; error?: string }> {
    try {
      this.assertSafeWebhookUrl(webhookUrl);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          text: 'ShipSec test message — your Slack webhook is configured correctly.',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Webhook test failed: ${response.status} ${errorText}`);
        return { ok: false, error: `Webhook returned status ${response.status}: ${errorText}` };
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
   * Test a bot token and return workspace info.
   */
  async authTest(botToken: string): Promise<{
    ok: boolean;
    error?: string;
    teamName?: string;
    teamId?: string;
    userId?: string;
    url?: string;
  }> {
    try {
      const result = await this.client(botToken).auth.test();
      return {
        ok: true,
        teamName: result.team,
        teamId: result.team_id,
        userId: result.user_id,
        url: result.url,
      };
    } catch (error: any) {
      this.logger.error(`Slack auth.test failed: ${error.message}`);
      return { ok: false, error: error.data?.error ?? error.message };
    }
  }

  /**
   * Fetch workspace info (name + icon) via team.info.
   */
  async getTeamInfo(
    botToken: string,
  ): Promise<{ ok: boolean; icon?: string; name?: string; id?: string }> {
    try {
      const result = await this.client(botToken).team.info();
      const icons = (result.team as any)?.icon ?? {};
      const icon =
        icons.image_230 || icons.image_132 || icons.image_88 || icons.image_68 || icons.image_44;

      return {
        ok: true,
        icon: icons.image_default ? undefined : icon,
        name: result.team?.name,
        id: result.team?.id,
      };
    } catch (error: any) {
      this.logger.warn('Failed to fetch team.info (non-critical):', error.message);
      return { ok: false };
    }
  }

  /**
   * List channels accessible to the bot.
   */
  async listChannels(botToken: string): Promise<{ channels: { id: string; name: string }[] }> {
    try {
      const result = await this.client(botToken).conversations.list();
      const channels = (result.channels ?? []).map((ch) => ({
        id: ch.id!,
        name: ch.name!,
      }));
      return { channels };
    } catch (error: any) {
      this.logger.error('Error listing Slack channels:', error.message);
      throw error;
    }
  }

  private messageOptions(
    text: string,
    blocks?: Record<string, unknown>[],
  ): {
    text: string;
    blocks?: Record<string, unknown>[];
    mrkdwn: boolean;
    unfurl_links: boolean;
    unfurl_media: boolean;
  } {
    return {
      text,
      blocks,
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false,
    };
  }

  /**
   * Send a message to a channel.
   */
  async sendMessage(
    botToken: string,
    channel: string,
    text: string,
    blocks?: Record<string, unknown>[],
  ): Promise<SlackPostedMessage> {
    try {
      const result = await this.client(botToken).chat.postMessage({
        channel,
        ...this.messageOptions(text, blocks),
      });
      return { ok: true, ts: result.ts };
    } catch (error: any) {
      this.logger.error(`Failed to send message: ${error.message}`);
      return { ok: false, error: error.data?.error ?? error.message };
    }
  }

  /**
   * Post a message as a thread reply.
   */
  async postThreadMessage(
    botToken: string,
    channel: string,
    text: string,
    threadTs: string,
    blocks?: Record<string, unknown>[],
  ): Promise<SlackPostedMessage> {
    try {
      const result = await this.client(botToken).chat.postMessage({
        channel,
        thread_ts: threadTs,
        ...this.messageOptions(text, blocks),
      });
      return { ok: true, ts: result.ts };
    } catch (error: any) {
      this.logger.error(`Failed to post thread message: ${error.message}`);
      return { ok: false, error: error.data?.error ?? error.message };
    }
  }

  async updateMessage(
    botToken: string,
    channel: string,
    ts: string,
    text: string,
    blocks?: Record<string, unknown>[],
  ): Promise<SlackPostedMessage> {
    try {
      const result = await this.client(botToken).chat.update({
        channel,
        ts,
        ...this.messageOptions(text, blocks),
      });
      return { ok: true, ts: result.ts };
    } catch (error: any) {
      this.logger.error(`Failed to update Slack message: ${error.message}`);
      return { ok: false, error: error.data?.error ?? error.message };
    }
  }

  async deleteMessage(botToken: string, channel: string, ts: string): Promise<SlackPostedMessage> {
    try {
      await this.client(botToken).chat.delete({ channel, ts });
      return { ok: true, ts };
    } catch (error: any) {
      this.logger.error(`Failed to delete Slack message: ${error.message}`);
      return { ok: false, error: error.data?.error ?? error.message };
    }
  }

  /**
   * Fetch all replies in a thread (for context reconstruction).
   */
  async getThreadReplies(
    botToken: string,
    channel: string,
    threadTs: string,
  ): Promise<{ ok: boolean; messages: any[]; error?: string }> {
    try {
      const result = await this.client(botToken).conversations.replies({
        channel,
        ts: threadTs,
        limit: 100,
      });
      return { ok: true, messages: result.messages ?? [] };
    } catch (error: any) {
      this.logger.error(`Failed to fetch thread replies: ${error.message}`);
      return { ok: false, messages: [], error: error.data?.error ?? error.message };
    }
  }

  /**
   * Get the bot's own user ID (for echo detection).
   */
  async getBotUserId(botToken: string): Promise<string> {
    const result = await this.authTest(botToken);
    if (!result.ok) {
      throw new Error(`Failed to get bot user ID: ${result.error}`);
    }
    return result.userId ?? '';
  }
}
