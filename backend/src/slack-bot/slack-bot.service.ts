import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { integrationTokens } from '../database/schema';
import { ChatService } from '../chat/chat.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { SlackService } from '../integrations/slack.service';
import { SlackThreadMappingRepository } from './slack-thread-mapping.repository';
import { SlackEventBridge } from './slack-event-bridge';
import type { AuthContext } from '../auth/types';

interface SlackEventPayload {
  type: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
}

@Injectable()
export class SlackBotService {
  private readonly logger = new Logger(SlackBotService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase,
    private readonly chatService: ChatService,
    private readonly integrations: IntegrationsService,
    private readonly slack: SlackService,
    private readonly threadMappings: SlackThreadMappingRepository,
    private readonly eventBridge: SlackEventBridge,
  ) {}

  async processAppMention(event: SlackEventPayload, teamId: string): Promise<void> {
    if (this.isEcho(event)) return;

    const creds = await this.resolveSlackCredentials(teamId);
    if (!creds) return;

    const text = this.stripMention(event.text ?? '', creds.botUserId);
    if (!text.trim()) return;

    // Normalize thread key: use existing thread root if mentioned inside a thread, otherwise the mention message becomes the root
    const threadTs = event.thread_ts ?? event.ts!;
    const channelId = event.channel!;

    let mapping = await this.threadMappings.findByThread(teamId, channelId, threadTs);

    if (!mapping) {
      const auth = this.buildSystemAuth(creds.organizationId);
      const session = await this.chatService.createSession(auth, `Slack: ${text.slice(0, 50)}`);

      await this.threadMappings.setSessionOrigin(session.id, 'slack');

      mapping = await this.threadMappings.create({
        sessionId: session.id,
        slackTeamId: teamId,
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        connectionId: creds.connectionId,
        botUserId: creds.botUserId,
      });

      this.logger.log(`Created Slack session ${session.id} for thread ${threadTs}`);

      // Subscribe the event bridge to relay responses back to Slack
      await this.eventBridge.subscribeToSession(session.id);
    }

    // Use event.ts as stable clientSubmissionId for idempotency on Slack retries
    await this.chatService.submitOperation(
      mapping.sessionId,
      {
        op: 'UserTurn',
        text,
        clientSubmissionId: `slack-${event.ts}`,
      },
      this.buildSystemAuth(creds.organizationId),
    );
  }

  async processDirectMessage(event: SlackEventPayload, teamId: string): Promise<void> {
    if (this.isEcho(event)) return;

    const creds = await this.resolveSlackCredentials(teamId);
    if (!creds) return;

    const text = event.text ?? '';
    if (!text.trim()) return;

    const channelId = event.channel!;
    // Use a stable key for DMs: one session per DM channel (not per message)
    const threadTs = `dm:${channelId}`;

    let mapping = await this.threadMappings.findByThread(teamId, channelId, threadTs);

    if (!mapping) {
      const auth = this.buildSystemAuth(creds.organizationId);
      const session = await this.chatService.createSession(auth, `DM: ${text.slice(0, 50)}`);

      await this.threadMappings.setSessionOrigin(session.id, 'slack');

      mapping = await this.threadMappings.create({
        sessionId: session.id,
        slackTeamId: teamId,
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        connectionId: creds.connectionId,
        botUserId: creds.botUserId,
      });

      this.logger.log(`Created DM session ${session.id} for channel ${channelId}`);

      await this.eventBridge.subscribeToSession(session.id);
    }

    await this.chatService.submitOperation(
      mapping.sessionId,
      {
        op: 'UserTurn',
        text,
        clientSubmissionId: `slack-dm-${event.ts}`,
      },
      this.buildSystemAuth(creds.organizationId),
    );
  }

  async processThreadReply(event: SlackEventPayload, teamId: string): Promise<void> {
    if (this.isEcho(event)) return;

    const channelId = event.channel!;
    const threadTs = event.thread_ts!;

    const mapping = await this.threadMappings.findByThread(teamId, channelId, threadTs);
    if (!mapping) return;

    const text = event.text ?? '';
    if (!text.trim()) return;

    const creds = await this.resolveSlackCredentials(teamId);
    if (!creds) return;

    await this.chatService.submitOperation(
      mapping.sessionId,
      {
        op: 'UserTurn',
        text,
        clientSubmissionId: `slack-reply-${event.ts}`,
      },
      this.buildSystemAuth(creds.organizationId),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isEcho(event: SlackEventPayload): boolean {
    return !!event.bot_id;
  }

  private stripMention(text: string, botUserId: string): string {
    return text.replace(new RegExp(`<@${botUserId}>\\s*`, 'g'), '').trim();
  }

  /**
   * Find the Slack OAuth connection for a given team ID.
   * Queries all Slack connections and matches by team ID in metadata.
   */
  private async resolveSlackCredentials(teamId: string): Promise<{
    botToken: string;
    connectionId: string;
    botUserId: string;
    organizationId: string;
  } | null> {
    try {
      // Find all Slack OAuth connections
      const connections = await this.db
        .select()
        .from(integrationTokens)
        .where(eq(integrationTokens.provider, 'slack'));

      // Match by team ID in metadata.providerPayload.team.id
      const match = connections.find((c) => {
        const meta = (c.metadata ?? {}) as Record<string, any>;
        const payload = meta.providerPayload ?? {};
        return payload.team?.id === teamId;
      });

      if (!match) {
        this.logger.warn(`No Slack connection found for team ${teamId}`);
        return null;
      }

      const credentials = await this.integrations.resolveConnectionCredentials(match.id);
      const botToken = credentials.data?.accessToken as string;
      if (!botToken) {
        this.logger.warn(`No bot token for Slack connection ${match.id}`);
        return null;
      }

      const botUserId = await this.slack.getBotUserId(botToken);

      return {
        botToken,
        connectionId: match.id,
        botUserId,
        organizationId: match.organizationId,
      };
    } catch (err: any) {
      this.logger.error(`Failed to resolve Slack credentials for team ${teamId}: ${err.message}`);
      return null;
    }
  }

  private buildSystemAuth(organizationId: string): AuthContext {
    return {
      userId: 'slack-bot',
      organizationId,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'slack-bot',
    };
  }
}
