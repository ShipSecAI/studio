import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListFilesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export class ListFilesQueryDto extends createZodDto(ListFilesQuerySchema) {}
export type ListFilesQuery = z.infer<typeof ListFilesQuerySchema>;

export const FileUploadResponseSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  storageKey: z.string(),
  uploadedAt: z.string().datetime(),
});
export class FileUploadResponseDto extends createZodDto(FileUploadResponseSchema) {}

export const FileListItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  uploadedAt: z.string().datetime(),
});
export class FileListItemDto extends createZodDto(FileListItemSchema) {}
