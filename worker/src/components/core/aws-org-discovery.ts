import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  defineComponent,
  inputs,
  outputs,
  port,
} from '@shipsec/component-sdk';
import { awsCredentialSchema } from '@shipsec/contracts';
import { OrganizationsClient, paginateListAccounts } from '@aws-sdk/client-organizations';

/**
 * Reusable helper: discovers all accounts in an AWS Organization.
 * Exported for use by other components (e.g. prowler org scan).
 */
export async function discoverOrgAccounts(
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region?: string;
  },
  region?: string,
): Promise<{ id: string; name: string; status: string; email: string }[]> {
  const client = new OrganizationsClient({
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
    region: region ?? credentials.region ?? 'us-east-1',
  });

  const accounts: { id: string; name: string; status: string; email: string }[] = [];
  const paginator = paginateListAccounts({ client }, {});

  for await (const page of paginator) {
    if (page.Accounts) {
      for (const account of page.Accounts) {
        accounts.push({
          id: account.Id ?? '',
          name: account.Name ?? '',
          status: account.Status ?? 'UNKNOWN',
          email: account.Email ?? '',
        });
      }
    }
  }

  return accounts;
}

const inputSchema = inputs({
  credentials: port(awsCredentialSchema(), {
    label: 'AWS Credentials',
    description: 'AWS credentials with permissions to list organization accounts.',
    connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
  }),
});

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  email: z.string(),
});

const outputSchema = outputs({
  accounts: port(z.array(accountSchema), {
    label: 'Accounts',
    description: 'List of AWS Organization accounts',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  organizationId: port(z.string().optional(), {
    label: 'Organization ID',
    description: 'AWS Organization ID',
  }),
});

const definition = defineComponent({
  id: 'core.aws.org-discovery',
  label: 'AWS Org Discovery',
  category: 'process',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Discover all accounts in an AWS Organization using the provided credentials. Paginates through all accounts automatically.',
  ui: {
    slug: 'aws-org-discovery',
    version: '1.0.0',
    type: 'process',
    category: 'cloud',
    description: 'List all AWS Organization accounts to enable multi-account workflows.',
    icon: 'Cloud',
  },
  async execute({ inputs }, context) {
    const creds = inputSchema.parse(inputs).credentials;

    if (!creds.accessKeyId || !creds.secretAccessKey) {
      throw new ConfigurationError(
        'AWS credentials (accessKeyId and secretAccessKey) are required.',
        { configKey: 'credentials' },
      );
    }

    context.emitProgress('Discovering AWS Organization accounts...');

    const accounts = await discoverOrgAccounts(creds, creds.region);

    context.logger.info(
      `[AWSOrGDiscovery] Discovered ${accounts.length} accounts in the organization.`,
    );
    context.emitProgress(`Found ${accounts.length} AWS Organization accounts.`);

    return outputSchema.parse({
      accounts,
      organizationId: undefined,
    });
  },
});

componentRegistry.register(definition);
