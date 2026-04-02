import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { SlackSigningGuard } from './slack-signing.guard';
import { SlackBotService } from './slack-bot.service';

interface SlackEvent {
  type: string;
  challenge?: string;
  token?: string;
  team_id?: string;
  event?: {
    type: string;
    user?: string;
    bot_id?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
    event_ts?: string;
  };
}

@ApiTags('slack-bot')
@Controller('slack')
export class SlackEventsController {
  private readonly logger = new Logger(SlackEventsController.name);

  constructor(private readonly slackBot: SlackBotService) {}

  @Post('events')
  @Public()
  @UseGuards(SlackSigningGuard)
  @HttpCode(HttpStatus.OK)
  async handleEvent(@Body() body: SlackEvent) {
    // URL verification challenge
    if (body.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    // Event callback
    if (body.type === 'event_callback' && body.event) {
      const { event, team_id: teamId } = body;

      if (!teamId) {
        this.logger.warn('Received event without team_id');
        return { ok: true };
      }

      // Gate on feature flag — signing guard still runs so we verify authenticity,
      // but we skip processing when the bot is disabled.
      if (process.env.SLACK_BOT_ENABLED !== 'true') {
        this.logger.debug('Slack bot disabled — ignoring event');
        return { ok: true };
      }

      // Process async — respond 200 immediately
      this.processEventAsync(event, teamId).catch((err) => {
        this.logger.error(`Error processing Slack event: ${err.message}`, err.stack);
      });
    }

    return { ok: true };
  }

  private async processEventAsync(
    event: NonNullable<SlackEvent['event']>,
    teamId: string,
  ): Promise<void> {
    switch (event.type) {
      case 'app_mention':
        await this.slackBot.processAppMention(event, teamId);
        break;

      case 'message':
        // DMs disabled for now — visibility model needs per-user scoping first
        if (event.channel_type === 'im') {
          this.logger.debug('Ignoring DM event — DM support disabled');
          break;
        }
        // Thread replies in channels
        if (event.thread_ts) {
          await this.slackBot.processThreadReply(event, teamId);
        }
        break;

      default:
        this.logger.debug(`Ignoring Slack event type: ${event.type}`);
    }
  }
}
