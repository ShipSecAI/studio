import { z } from 'zod';
import { registerContract } from '@shipsec/component-sdk';

export const awsCredentialContractName = 'core.credential.aws';

export const awsCredentialSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string().optional(),
  region: z.string().optional(),
});

registerContract({
  name: awsCredentialContractName,
  schema: awsCredentialSchema,
});
