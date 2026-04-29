import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { InternalOnly } from '../common/guards/internal-only.guard';
import { AsmService } from './asm.service';
import {
  UpsertAsmAssetsRequestDto,
  UpsertAsmAssetsRequestSchema,
  UpsertAsmAssetsResponseDto,
} from './dto/upsert-assets.dto';

@ApiTags('asm')
@Controller('asm/internal')
export class AsmInternalController {
  constructor(private readonly asmService: AsmService) {}

  @Post('assets/upsert')
  @InternalOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UpsertAsmAssetsResponseDto })
  async upsertAssets(
    @Headers('x-organization-id') organizationId: string,
    @Body(new ZodValidationPipe(UpsertAsmAssetsRequestSchema)) body: UpsertAsmAssetsRequestDto,
  ) {
    return this.asmService.upsertAssetsForDomain(organizationId, body);
  }
}
