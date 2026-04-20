import type { Type } from '@nestjs/common';

type NestModule = Type<unknown>;

export function getBackendCloudModules(): NestModule[] {
  return [];
}
