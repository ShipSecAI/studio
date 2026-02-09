import { Injectable, Logger } from '@nestjs/common';
import { SecretEncryption, parseMasterKey, SecretEncryptionMaterial } from '@shipsec/shared';

@Injectable()
export class SecretsEncryptionService {
  private readonly logger = new Logger(SecretsEncryptionService.name);
  private readonly encryptor: SecretEncryption;

  constructor() {
    const rawKey = process.env.SECRET_STORE_MASTER_KEY;
    if (!rawKey) {
      throw new Error(
        'SECRET_STORE_MASTER_KEY environment variable is required. Set it to a secure 32-byte hex string for production use.',
      );
    }

    const masterKey = parseMasterKey(rawKey);
    this.encryptor = new SecretEncryption(masterKey);
  }

  async encrypt(value: string): Promise<SecretEncryptionMaterial> {
    return this.encryptor.encrypt(value);
  }

  async decrypt(material: SecretEncryptionMaterial): Promise<string> {
    this.logger.debug(`Decrypting secret material with key ${material.keyId ?? 'unknown'}`);
    const value = await this.encryptor.decrypt(material);
    this.logger.debug(`Successfully decrypted secret (length: ${value.length})`);
    return value;
  }

  get keyId(): string {
    return this.encryptor.keyIdentifier;
  }
}
