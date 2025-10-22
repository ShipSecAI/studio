export interface SecretEncryptionMaterial {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
}

export class SecretEncryption {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(
    masterKey: CryptoKey | ArrayBuffer | ArrayBufferView,
    private readonly keyId: string = 'primary',
  ) {
    this.keyPromise = this.normalizeKey(masterKey);
  }

  get keyIdentifier(): string {
    return this.keyId;
  }

  static async importKey(rawKey: ArrayBuffer | ArrayBufferView): Promise<CryptoKey> {
    const keyData = ArrayBuffer.isView(rawKey)
      ? rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength)
      : rawKey;

    return await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(plaintext: string): Promise<SecretEncryptionMaterial> {
    const masterKey = await this.keyPromise;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encoded = encoder.encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      masterKey,
      encoded
    );

    const ciphertextBytes = new Uint8Array(ciphertext);
    if (ciphertextBytes.length < 16) {
      throw new Error('Encrypted payload shorter than authentication tag length.');
    }

    const dataBytes = ciphertextBytes.slice(0, ciphertextBytes.length - 16);
    const tagBytes = ciphertextBytes.slice(ciphertextBytes.length - 16);

    return {
      ciphertext: SecretEncryption.encode(dataBytes),
      authTag: SecretEncryption.encode(tagBytes),
      iv: SecretEncryption.encode(iv),
      keyId: this.keyId,
    };
  }

  async decrypt(material: SecretEncryptionMaterial): Promise<string> {
    const masterKey = await this.keyPromise;
    const iv = SecretEncryption.decode(material.iv);
    const ciphertext = SecretEncryption.decode(material.ciphertext);
    const authTag = material.authTag ? SecretEncryption.decode(material.authTag) : new Uint8Array();

    const payload = new Uint8Array(ciphertext.length + authTag.length);
    payload.set(ciphertext);
    payload.set(authTag, ciphertext.length);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      masterKey,
      payload
    );

    return new TextDecoder().decode(decrypted);
  }

  private async normalizeKey(
    masterKey: CryptoKey | ArrayBuffer | ArrayBufferView,
  ): Promise<CryptoKey> {
    if (SecretEncryption.isCryptoKey(masterKey)) {
      return masterKey;
    }

    return SecretEncryption.importKey(masterKey);
  }

  private static isCryptoKey(value: unknown): value is CryptoKey {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      'algorithm' in value &&
      'extractable' in value
    );
  }

  private static encode(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }

  private static decode(payload: string): Uint8Array {
    return Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  }
}

// Helper to prepare a 32-byte master key
export function parseMasterKey(raw: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength !== 32) {
    throw new Error('Key must be exactly 32 bytes.');
  }
  return bytes.buffer;
}
