import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { DestinationAdapterRegistration, DestinationSaveInput, DestinationSaveResult } from '../registry';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { ConfigurationError } from '@shipsec/component-sdk';

interface AwsCredentialPayload {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
}

interface S3AdapterConfig {
  bucket: string;
  region?: string;
  objectKey?: string;
  pathPrefix?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  publicUrl?: string;
  credentials?: AwsCredentialPayload;
}

function buildObjectKey(config: S3AdapterConfig, fileName: string) {
  if (config.objectKey) {
    return config.objectKey.replace(/^\/+/, '');
  }
  const prefix = config.pathPrefix?.replace(/^\/+/, '').replace(/\/+$/, '');
  return prefix ? `${prefix}/${fileName}` : fileName;
}

export const s3DestinationAdapter: DestinationAdapterRegistration = {
  id: 's3',
  label: 'Amazon S3',
  description: 'Upload artifacts to an S3 bucket (or S3-compatible storage).',
  parameters: [
    { id: 'bucket', label: 'Bucket', type: 'text', required: true },
    { id: 'region', label: 'Region', type: 'text' },
    { id: 'pathPrefix', label: 'Path prefix', type: 'text' },
    { id: 'objectKey', label: 'Explicit object key', type: 'text' },
    { id: 'endpoint', label: 'Custom endpoint', type: 'text' },
    { id: 'forcePathStyle', label: 'Force path style', type: 'boolean' },
    { id: 'publicUrl', label: 'Public URL prefix', type: 'text' },
  ],
  create(rawConfig) {
    return {
      async save(input: DestinationSaveInput, context: ExecutionContext): Promise<DestinationSaveResult> {
        const config = ensureS3Config(rawConfig);
        const credentials = ensureAwsCredentials(config);
        const key = buildObjectKey(config, input.fileName);

        const client = new S3Client({
          region: credentials.region ?? config.region ?? 'us-east-1',
          endpoint: config.endpoint,
          forcePathStyle: config.forcePathStyle,
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
          },
        });

        context.logger.info(
          `[Destination:S3] Uploading ${input.fileName} (${input.buffer.byteLength} bytes) to s3://${config.bucket}/${key}`,
        );

        const command = new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: input.buffer,
          ContentType: input.mimeType,
          Metadata: {
            'shipsec-run-id': context.runId,
            'shipsec-component-ref': context.componentRef,
          },
        });

        const response = await client.send(command);
        const uri = `s3://${config.bucket}/${key}`;
        const publicUrl = config.publicUrl ? `${config.publicUrl.replace(/\/+$/, '')}/${key}` : undefined;

        return {
          remoteUploads: [
            {
              type: 's3',
              bucket: config.bucket,
              key,
              uri,
              url: publicUrl,
              region: credentials.region ?? config.region,
              etag: typeof response.ETag === 'string' ? response.ETag.replace(/"/g, '') : undefined,
            },
          ],
        };
      },
    };
  },
};

function ensureS3Config(config: unknown): S3AdapterConfig {
  if (!isS3Config(config)) {
    throw new ConfigurationError('S3 destination requires a bucket name.', {
      configKey: 'bucket',
      details: { receivedConfig: typeof config },
    });
  }
  return config;
}

function isS3Config(config: unknown): config is S3AdapterConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }
  const candidate = config as Partial<S3AdapterConfig>;
  return typeof candidate.bucket === 'string' && candidate.bucket.length > 0;
}

function ensureAwsCredentials(config: S3AdapterConfig): AwsCredentialPayload {
  if (!config.credentials) {
    throw new ConfigurationError('S3 destination requires AWS credentials to be provided via the credentials port.', {
      configKey: 'credentials',
    });
  }
  const { accessKeyId, secretAccessKey, sessionToken, region } = config.credentials;
  if (!accessKeyId || !secretAccessKey) {
    throw new ConfigurationError('S3 destination requires both access key ID and secret access key.', {
      configKey: 'credentials',
      details: { hasAccessKeyId: !!accessKeyId, hasSecretAccessKey: !!secretAccessKey },
    });
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
  };
}
