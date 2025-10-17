import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile as NestUploadedFile,
  BadRequestException,
  StreamableFile,
  Res,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express-serve-static-core';

import { FilesService } from './files.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to upload',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'File uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        size: { type: 'number' },
        storageKey: { type: 'string' },
        uploadedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@NestUploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return this.filesService.uploadFile(file.originalname, file.buffer, file.mimetype);
  }

  @Get()
  @ApiOkResponse({
    description: 'List all uploaded files',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          fileName: { type: 'string' },
          mimeType: { type: 'string' },
          size: { type: 'number' },
          uploadedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async listFiles(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    return this.filesService.listFiles(parsedLimit);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Get file metadata',
  })
  async getFile(@Param('id') id: string) {
    return this.filesService.getFileById(id);
  }

  @Get(':id/download')
  @ApiOkResponse({
    description: 'Download file',
    content: {
      'application/octet-stream': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async downloadFile(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, file } = await this.filesService.downloadFile(id);

    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': file.size,
    });

    return new StreamableFile(buffer);
  }

  @Delete(':id')
  @ApiOkResponse({
    description: 'Delete file',
  })
  async deleteFile(@Param('id') id: string) {
    await this.filesService.deleteFile(id);
    return { status: 'deleted', id };
  }
}

