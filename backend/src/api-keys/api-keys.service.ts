import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { apiKeys, type ApiKey, type ApiKeyPermissions } from '../database/schema/api-keys';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import type { CreateApiKeyDto, ListApiKeysQueryDto, UpdateApiKeyDto } from './dto/api-key.dto';
import type { AuthContext } from '../auth/types';

const KEY_PREFIX = 'sk_live_';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(auth: AuthContext, dto: CreateApiKeyDto) {
    if (!auth.organizationId) {
      throw new InternalServerErrorException('Organization ID missing in context');
    }

    const { key: plainKey, id: keyId } = this.generateKeyWithId();
    const keyHash = await bcrypt.hash(plainKey, 10);

    const [apiKey] = await this.db
      .insert(apiKeys)
      .values({
        name: dto.name,
        description: dto.description,
        keyHash,
        keyPrefix: KEY_PREFIX,
        keyHint: keyId,
        permissions: dto.permissions,
        organizationId: dto.organizationId ?? auth.organizationId,
        createdBy: auth.userId || 'system',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        rateLimit: dto.rateLimit,
        isActive: true,
      })
      .returning();

    return { apiKey, plainKey };
  }

  async list(auth: AuthContext, query: ListApiKeysQueryDto) {
    if (!auth.organizationId) {
      return [];
    }

    const conditions = [eq(apiKeys.organizationId, auth.organizationId)];
    
    if (query.isActive !== undefined) {
      conditions.push(eq(apiKeys.isActive, query.isActive));
    }

    return this.db
      .select()
      .from(apiKeys)
      .where(and(...conditions))
      .orderBy(desc(apiKeys.createdAt))
      .limit(query.limit)
      .offset(query.offset);
  }

  async get(auth: AuthContext, id: string) {
    if (!auth.organizationId) {
      throw new NotFoundException('API key not found');
    }

    const [apiKey] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, auth.organizationId)));

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    return apiKey;
  }

  async update(auth: AuthContext, id: string, dto: UpdateApiKeyDto) {
    if (!auth.organizationId) {
      throw new NotFoundException('API key not found');
    }

    const [apiKey] = await this.db
      .update(apiKeys)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, auth.organizationId)))
      .returning();

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    return apiKey;
  }

  async delete(auth: AuthContext, id: string) {
    if (!auth.organizationId) {
      throw new NotFoundException('API key not found');
    }

    const result = await this.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, auth.organizationId)));

    if (result.rowCount === 0) {
      throw new NotFoundException('API key not found');
    }
  }

  async validateKey(plainKey: string): Promise<ApiKey | null> {
    // Basic format check
    if (!plainKey.startsWith(KEY_PREFIX)) {
      return null;
    }

    const parts = plainKey.split('_');
    // Expected format: sk_live_<8-char-id>_<secret>
    if (parts.length !== 4) return null;
    
    const [sk, env, id, secret] = parts;
    if (sk !== 'sk' || env !== 'live') return null;
    
    // Look up by keyHint (which stores the ID part of the key)
    // This allows us to find the specific key record without scanning all keys
    const candidates = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHint, id), eq(apiKeys.isActive, true)));
      
    for (const key of candidates) {
      const match = await bcrypt.compare(plainKey, key.keyHash);
      if (match) {
        // Check expiration
        if (key.expiresAt && key.expiresAt < new Date()) {
          return null;
        }
        
        // Update stats (async, don't await)
        this.updateUsage(key.id);
        
        return key;
      }
    }
    
    return null;
  }
  
  private async updateUsage(id: string) {
    try {
      await this.db
        .update(apiKeys)
        .set({
          lastUsedAt: new Date(),
          usageCount: sql`${apiKeys.usageCount} + 1`,
        })
        .where(eq(apiKeys.id, id));
    } catch (e) {
      this.logger.error(`Failed to update usage for key ${id}`, e);
    }
  }
  
  // Adjusted generation to match the lookup strategy
  private generateKeyWithId(): { key: string; id: string } {
    const id = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    const secret = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
    const key = `${KEY_PREFIX}${id}_${secret}`;
    return { key, id };
  }
  

}
