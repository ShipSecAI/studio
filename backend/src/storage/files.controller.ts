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
import { ZodValidationPipe } from 'nestjs-zod';
import type { Response } from 'express-serve-static-core';

import { FilesService } from './files.service';
import {
  ListFilesQueryDto,
  ListFilesQuerySchema,
  FileUploadResponseDto,
  FileListItemDto,
} from './dto/files.dto';
import { FileIdParamDto, FileIdParamSchema } from './dto/file-param.dto';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

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
  @ApiOkResponse({ description: 'File uploaded successfully', type: FileUploadResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@CurrentAuth() auth: AuthContext | null, @NestUploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return this.filesService.uploadFile(auth, file.originalname, file.buffer, file.mimetype);
  }

  @Get()
  @ApiOkResponse({ description: 'List all uploaded files', type: FileListItemDto, isArray: true })
  async listFiles(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListFilesQuerySchema)) query: ListFilesQueryDto,
  ) {
    return this.filesService.listFiles(auth, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Get file metadata',
  })
  async getFile(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FileIdParamSchema)) params: FileIdParamDto,
  ) {
    return this.filesService.getFileById(auth, params.id);
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
  async downloadFile(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FileIdParamSchema)) params: FileIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, file } = await this.filesService.downloadFile(auth, params.id);

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
  async deleteFile(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(FileIdParamSchema)) params: FileIdParamDto,
  ) {
    await this.filesService.deleteFile(auth, params.id);
    return { status: 'deleted', id: params.id };
  }
}
