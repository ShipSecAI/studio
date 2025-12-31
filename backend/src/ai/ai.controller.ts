import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Response } from 'express';

import { AiService } from './ai.service';
import { GenerateAiDto, GenerateAiSchema } from './dto/ai.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

type AiMessagePart = {
  type?: string;
  text?: string;
};

type AiChatMessage = {
  role?: string;
  content?: unknown;
  parts?: AiMessagePart[];
};

@ApiTags('AI')
@Controller('ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post()
  @ApiOkResponse({ description: 'AI SDK-compatible SSE stream' })
  async generate(
    @CurrentAuth() auth: AuthContext | null,
    @Res() res: Response,
    @Body(new ZodValidationPipe(GenerateAiSchema)) dto: GenerateAiDto,
  ) {
    this.requireAuth(auth);
    const prompt = this.extractPrompt(dto);
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    const result = await this.aiService.generate({
      prompt,
      systemPrompt: dto.systemPrompt,
      mode: 'streaming',
      model: dto.model,
      context: dto.context ? { type: dto.context } : undefined,
    });

    if (result.stream) {
      result.stream.pipeUIMessageStreamToResponse(res, {
        originalMessages: dto.messages as AiChatMessage[] | undefined,
      });
      return;
    }

    throw new Error('Streaming not available');
  }

  @Post('generate-structured')
  @ApiOkResponse({ description: 'Structured template generation response' })
  async generateStructured(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(GenerateAiSchema)) dto: GenerateAiDto,
  ) {
    this.requireAuth(auth);
    const prompt = this.extractPrompt(dto);
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    return this.aiService.generateTemplate(prompt, {
      systemPrompt: dto.systemPrompt,
      model: dto.model,
    });
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

  private extractPrompt(dto: GenerateAiDto): string {
    if (dto.prompt?.trim()) {
      return dto.prompt.trim();
    }

    if (!dto.messages || !Array.isArray(dto.messages)) {
      return '';
    }

    for (let index = dto.messages.length - 1; index >= 0; index -= 1) {
      const message = dto.messages[index] as AiChatMessage;
      if (message?.role && message.role !== 'user') {
        continue;
      }

      if (typeof message?.content === 'string' && message.content.trim()) {
        return message.content.trim();
      }

      if (Array.isArray(message?.parts)) {
        const text = message.parts
          .filter((part) => part?.type === 'text')
          .map((part) => part?.text ?? '')
          .join('')
          .trim();
        if (text) {
          return text;
        }
      }
    }

    return '';
  }
}
