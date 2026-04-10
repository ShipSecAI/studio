import { Controller, Get, Headers, BadRequestException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { InternalOnly } from '../common/guards/internal-only.guard';
import { BifrostKeyResolverService } from './bifrost-key-resolver.service';
import { BifrostKeyResponseDto } from './dto/internal-billing.dto';

@ApiTags('internal-billing')
@Controller('internal/billing')
export class InternalBillingController {
  constructor(private readonly keyResolver: BifrostKeyResolverService) {}

  @Get('bifrost-key')
  @InternalOnly()
  @ApiOkResponse({ type: BifrostKeyResponseDto })
  async getBifrostKey(
    @Headers('x-organization-id') organizationId?: string,
  ): Promise<BifrostKeyResponseDto> {
    if (!organizationId) {
      throw new BadRequestException('x-organization-id header is required');
    }

    const virtualKey = await this.keyResolver.resolveVirtualKey(organizationId.trim());

    return { virtualKey };
  }
}
