import { Injectable, Logger } from '@nestjs/common';
import { SecretEncryption, parseMasterKey, SecretEncryptionMaterial } from '@shipsec/shared';

const FALLBACK_DEV_KEY = '0123456789abcdef0123456789abcdef';

/**
 * Encryption service for MCP server headers.
 * Reuses the same encryption pattern as secrets for consistency.
 */
@Injectable()
export class McpServersEncryptionService {
  private readonly logger = new Logger(McpServersEncryptionService.name);
  private readonly encryptor: SecretEncryption;

  constructor() {
    const rawKey = process.env.SECRET_STORE_MASTER_KEY ?? FALLBACK_DEV_KEY;
    if (!process.env.SECRET_STORE_MASTER_KEY) {
      this.logger.warn(
        'SECRET_STORE_MASTER_KEY is not set. Using insecure default key for development purposes only.',
      );
    }

    const masterKey = parseMasterKey(rawKey);
    this.encryptor = new SecretEncryption(masterKey);
  }

  async encrypt(value: string): Promise<SecretEncryptionMaterial> {
    return this.encryptor.encrypt(value);
  }

  async decrypt(material: SecretEncryptionMaterial): Promise<string> {
    return this.encryptor.decrypt(material);
  }

  /**
   * Encrypt a headers object as JSON string.
   */
  async encryptHeaders(headers: Record<string, string>): Promise<SecretEncryptionMaterial> {
    const json = JSON.stringify(headers);
    return this.encrypt(json);
  }

  /**
   * Decrypt headers back to object.
   */
  async decryptHeaders(material: SecretEncryptionMaterial): Promise<Record<string, string>> {
    const json = await this.decrypt(material);
    return JSON.parse(json);
  }

  get keyId(): string {
    return this.encryptor.keyIdentifier;
  }
}
