import {
  BadRequestException,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UIMessage } from 'ai';

import { AiService } from './ai.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

/**
 * AI Controller - AI SDK v6 compatible
 * 
 * Receives UIMessage[] from useChat's DefaultChatTransport.
 * Returns toUIMessageStreamResponse() for streaming.
 */
@ApiTags('AI')
@Controller('ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Main chat endpoint
   * 
   * Receives: { messages: UIMessage[], id?, systemPrompt?, context?, model? }
   * Returns: UI Message Stream Response
   */
  @Post()
  @ApiOkResponse({ description: 'AI SDK v6 UI message stream' })
  async chat(
    @CurrentAuth() auth: AuthContext | null,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.requireAuth(auth);

    const body = req.body as { 
      messages: UIMessage[]; 
      systemPrompt?: string;
      context?: string;
      model?: string;
    };

    const { messages, systemPrompt, context, model } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException('Messages are required');
    }

    const system = systemPrompt || this.aiService.buildSystemPrompt(context);

    const result = await this.aiService.streamChat(messages, { system, model, context });

    // toUIMessageStreamResponse returns a Response object
    // We need to pipe it to Express response
    const streamResponse = result.toUIMessageStreamResponse();
    
    // Set headers from the stream response
    res.setHeader('Content-Type', streamResponse.headers.get('Content-Type') || 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the body to the response
    if (streamResponse.body) {
      const reader = streamResponse.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          res.write(value);
        }
      };
      pump().catch((err) => {
        console.error('Stream error:', err);
        res.end();
      });
    } else {
      res.end();
    }
  }

  private requireAuth(auth: AuthContext | null): AuthContext {
    if (!auth?.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return auth;
  }
}
