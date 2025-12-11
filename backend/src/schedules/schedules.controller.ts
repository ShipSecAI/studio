import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  CreateScheduleRequestDto,
  CreateScheduleRequestSchema,
  ListSchedulesQueryDto,
  ListSchedulesQuerySchema,
  ScheduleResponseDto,
  UpdateScheduleRequestDto,
  UpdateScheduleRequestSchema,
} from './dto/schedule.dto';
import { SchedulesService } from './schedules.service';

@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListSchedulesQuerySchema))
    query: ListSchedulesQueryDto,
  ): Promise<{ schedules: ScheduleResponseDto[] }> {
    const schedules = await this.schedulesService.list(auth, query);
    return {
      schedules: schedules.map((schedule) => ScheduleResponseDto.create(schedule)),
    };
  }

  @Get(':id')
  async getOne(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<ScheduleResponseDto> {
    const schedule = await this.schedulesService.get(auth, id);
    return ScheduleResponseDto.create(schedule);
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(CreateScheduleRequestSchema))
    body: CreateScheduleRequestDto,
  ): Promise<ScheduleResponseDto> {
    const schedule = await this.schedulesService.create(auth, body);
    return ScheduleResponseDto.create(schedule);
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateScheduleRequestSchema))
    body: UpdateScheduleRequestDto,
  ): Promise<ScheduleResponseDto> {
    const schedule = await this.schedulesService.update(auth, id, body);
    return ScheduleResponseDto.create(schedule);
  }

  @Delete(':id')
  async delete(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    await this.schedulesService.delete(auth, id);
    return { success: true };
  }

  @Post(':id/pause')
  async pause(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<ScheduleResponseDto> {
    const schedule = await this.schedulesService.pause(auth, id);
    return ScheduleResponseDto.create(schedule);
  }

  @Post(':id/resume')
  async resume(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<ScheduleResponseDto> {
    const schedule = await this.schedulesService.resume(auth, id);
    return ScheduleResponseDto.create(schedule);
  }

  @Post(':id/trigger')
  async trigger(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    await this.schedulesService.trigger(auth, id);
    return { success: true };
  }
}
