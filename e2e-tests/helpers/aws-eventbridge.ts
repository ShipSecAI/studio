/**
 * AWS EventBridge E2E Helpers
 *
 * Encapsulates all AWS CLI interactions for the GuardDuty → EventBridge → Webhook E2E test.
 * Uses Bun.spawn for async subprocess execution with JSON output parsing.
 * All resource names are prefixed with `shipsec-e2e-` + timestamp for idempotency.
 */

// ---------------------------------------------------------------------------
// Low-level AWS CLI runner
// ---------------------------------------------------------------------------

interface AwsCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function awsCli(args: string[], region?: string): Promise<AwsCliResult> {
  const fullArgs = ['aws', ...args];
  if (region) {
    fullArgs.push('--region', region);
  }
  fullArgs.push('--output', 'json');

  // Strip AWS credential env vars so the CLI falls back to the default profile
  // (admin user). The env vars from .env.e2e are scoped investigation keys
  // and must NOT be used for infra provisioning.
  const env = { ...process.env };
  delete env.AWS_ACCESS_KEY_ID;
  delete env.AWS_SECRET_ACCESS_KEY;
  delete env.AWS_SESSION_TOKEN;

  const proc = Bun.spawn(fullArgs, {
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

async function awsCliJson<T = any>(args: string[], region?: string): Promise<T> {
  const result = await awsCli(args, region);
  if (result.exitCode !== 0) {
    throw new Error(`AWS CLI failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  if (!result.stdout.trim()) return {} as T;
  return JSON.parse(result.stdout);
}

async function awsCliSafe(args: string[], region?: string): Promise<AwsCliResult> {
  return awsCli(args, region);
}

// ---------------------------------------------------------------------------
// GuardDuty
// ---------------------------------------------------------------------------

export async function ensureGuardDutyDetector(region: string): Promise<string> {
  const result = await awsCliJson<{ DetectorIds: string[] }>(
    ['guardduty', 'list-detectors'],
    region,
  );
  if (result.DetectorIds && result.DetectorIds.length > 0) {
    return result.DetectorIds[0];
  }
  throw new Error('No GuardDuty detector found. Enable GuardDuty in the AWS console first.');
}

export async function createSampleFindings(
  detectorId: string,
  region: string,
  findingTypes: string[] = ['Recon:EC2/PortProbeUnprotectedPort'],
): Promise<void> {
  await awsCliJson(
    [
      'guardduty',
      'create-sample-findings',
      '--detector-id',
      detectorId,
      '--finding-types',
      ...findingTypes,
    ],
    region,
  );
}

// ---------------------------------------------------------------------------
// IAM - User
// ---------------------------------------------------------------------------

export async function ensureInvestigatorUser(userName: string): Promise<{ arn: string }> {
  // Try to get existing user
  const getResult = await awsCliSafe(['iam', 'get-user', '--user-name', userName]);
  if (getResult.exitCode === 0) {
    const data = JSON.parse(getResult.stdout);
    console.log(`    IAM user ${userName} already exists, reusing.`);
    return { arn: data.User.Arn };
  }

  // Create new user
  const data = await awsCliJson<{ User: { Arn: string } }>([
    'iam',
    'create-user',
    '--user-name',
    userName,
  ]);
  console.log(`    IAM user ${userName} created.`);
  return { arn: data.User.Arn };
}

export async function createAccessKeys(
  userName: string,
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
  // Delete existing access keys first to avoid limit
  const listResult = await awsCliSafe([
    'iam',
    'list-access-keys',
    '--user-name',
    userName,
  ]);
  if (listResult.exitCode === 0) {
    const existing = JSON.parse(listResult.stdout);
    for (const key of existing.AccessKeyMetadata || []) {
      await awsCliSafe([
        'iam',
        'delete-access-key',
        '--user-name',
        userName,
        '--access-key-id',
        key.AccessKeyId,
      ]);
      console.log(`    Deleted old access key ${key.AccessKeyId}`);
    }
  }

  const data = await awsCliJson<{
    AccessKey: { AccessKeyId: string; SecretAccessKey: string };
  }>(['iam', 'create-access-key', '--user-name', userName]);

  return {
    accessKeyId: data.AccessKey.AccessKeyId,
    secretAccessKey: data.AccessKey.SecretAccessKey,
  };
}

export async function attachPolicy(userName: string, policyArn: string): Promise<void> {
  await awsCliSafe([
    'iam',
    'attach-user-policy',
    '--user-name',
    userName,
    '--policy-arn',
    policyArn,
  ]);
}

// ---------------------------------------------------------------------------
// IAM - EventBridge Target Role
// ---------------------------------------------------------------------------

export async function createEventBridgeTargetRole(roleName: string): Promise<string> {
  const trustPolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'events.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  });

  // Check if role exists
  const getResult = await awsCliSafe(['iam', 'get-role', '--role-name', roleName]);
  if (getResult.exitCode === 0) {
    const data = JSON.parse(getResult.stdout);
    console.log(`    IAM role ${roleName} already exists, reusing.`);
    return data.Role.Arn;
  }

  const data = await awsCliJson<{ Role: { Arn: string } }>([
    'iam',
    'create-role',
    '--role-name',
    roleName,
    '--assume-role-policy-document',
    trustPolicy,
  ]);

  // Attach inline policy for InvokeApiDestination
  const inlinePolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['events:InvokeApiDestination'],
        Resource: ['*'],
      },
    ],
  });

  await awsCliJson([
    'iam',
    'put-role-policy',
    '--role-name',
    roleName,
    '--policy-name',
    'InvokeApiDestination',
    '--policy-document',
    inlinePolicy,
  ]);

  console.log(`    IAM role ${roleName} created with InvokeApiDestination policy.`);
  return data.Role.Arn;
}

// ---------------------------------------------------------------------------
// EventBridge - Connection
// ---------------------------------------------------------------------------

export async function createConnection(
  name: string,
  region: string,
): Promise<string> {
  // Check if connection exists
  const descResult = await awsCliSafe(
    ['events', 'describe-connection', '--name', name],
    region,
  );
  if (descResult.exitCode === 0) {
    const data = JSON.parse(descResult.stdout);
    console.log(`    Connection ${name} already exists.`);
    return data.ConnectionArn;
  }

  const data = await awsCliJson<{ ConnectionArn: string }>(
    [
      'events',
      'create-connection',
      '--name',
      name,
      '--authorization-type',
      'API_KEY',
      '--auth-parameters',
      JSON.stringify({
        ApiKeyAuthParameters: {
          ApiKeyName: 'x-shipsec-e2e',
          ApiKeyValue: 'e2e-dummy-key',
        },
      }),
    ],
    region,
  );

  console.log(`    Connection ${name} created.`);
  return data.ConnectionArn;
}

export async function waitForConnection(
  name: string,
  region: string,
  timeoutMs = 30000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await awsCliSafe(
      ['events', 'describe-connection', '--name', name],
      region,
    );
    if (result.exitCode === 0) {
      const data = JSON.parse(result.stdout);
      if (data.ConnectionState === 'AUTHORIZED') {
        console.log(`    Connection ${name} is AUTHORIZED.`);
        return;
      }
      console.log(`    Connection ${name} state: ${data.ConnectionState}, waiting...`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Connection ${name} did not become AUTHORIZED within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// EventBridge - API Destination
// ---------------------------------------------------------------------------

export async function createApiDestination(
  name: string,
  connectionArn: string,
  endpoint: string,
  region: string,
): Promise<string> {
  // Check if exists
  const descResult = await awsCliSafe(
    ['events', 'describe-api-destination', '--name', name],
    region,
  );
  if (descResult.exitCode === 0) {
    const data = JSON.parse(descResult.stdout);
    // Update endpoint in case ngrok URL changed
    await awsCliSafe(
      [
        'events',
        'update-api-destination',
        '--name',
        name,
        '--connection-arn',
        connectionArn,
        '--invocation-endpoint',
        endpoint,
        '--http-method',
        'POST',
      ],
      region,
    );
    console.log(`    API Destination ${name} updated with new endpoint.`);
    return data.ApiDestinationArn;
  }

  const data = await awsCliJson<{ ApiDestinationArn: string }>(
    [
      'events',
      'create-api-destination',
      '--name',
      name,
      '--connection-arn',
      connectionArn,
      '--invocation-endpoint',
      endpoint,
      '--http-method',
      'POST',
      '--invocation-rate-limit-per-second',
      '1',
    ],
    region,
  );

  console.log(`    API Destination ${name} created → ${endpoint}`);
  return data.ApiDestinationArn;
}

// ---------------------------------------------------------------------------
// EventBridge - Rule + Target
// ---------------------------------------------------------------------------

export async function createRule(
  name: string,
  region: string,
  eventPattern: object,
): Promise<string> {
  const data = await awsCliJson<{ RuleArn: string }>(
    [
      'events',
      'put-rule',
      '--name',
      name,
      '--event-pattern',
      JSON.stringify(eventPattern),
      '--state',
      'ENABLED',
    ],
    region,
  );
  console.log(`    Rule ${name} created/updated.`);
  return data.RuleArn;
}

export async function putTarget(
  ruleName: string,
  targetId: string,
  apiDestinationArn: string,
  roleArn: string,
  region: string,
): Promise<void> {
  await awsCliJson(
    [
      'events',
      'put-targets',
      '--rule',
      ruleName,
      '--targets',
      JSON.stringify([
        {
          Id: targetId,
          Arn: apiDestinationArn,
          RoleArn: roleArn,
          HttpParameters: {
            HeaderParameters: {},
            QueryStringParameters: {},
          },
        },
      ]),
    ],
    region,
  );
  console.log(`    Target ${targetId} added to rule ${ruleName}.`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

interface CleanupResources {
  ruleName?: string;
  targetId?: string;
  apiDestinationName?: string;
  connectionName?: string;
  roleName?: string;
  userName?: string;
  region: string;
}

export async function cleanupAll(resources: CleanupResources): Promise<void> {
  const { region } = resources;
  console.log('\n  Cleanup: Tearing down AWS resources...');

  // 1. Remove target from rule
  if (resources.ruleName && resources.targetId) {
    const r = await awsCliSafe(
      [
        'events',
        'remove-targets',
        '--rule',
        resources.ruleName,
        '--ids',
        resources.targetId,
      ],
      region,
    );
    console.log(`    Remove target: ${r.exitCode === 0 ? 'OK' : 'skipped'}`);
  }

  // 2. Delete rule
  if (resources.ruleName) {
    const r = await awsCliSafe(
      ['events', 'delete-rule', '--name', resources.ruleName],
      region,
    );
    console.log(`    Delete rule: ${r.exitCode === 0 ? 'OK' : 'skipped'}`);
  }

  // 3. Delete API destination
  if (resources.apiDestinationName) {
    const r = await awsCliSafe(
      ['events', 'delete-api-destination', '--name', resources.apiDestinationName],
      region,
    );
    console.log(`    Delete API dest: ${r.exitCode === 0 ? 'OK' : 'skipped'}`);
  }

  // 4. Delete connection
  if (resources.connectionName) {
    const r = await awsCliSafe(
      ['events', 'delete-connection', '--name', resources.connectionName],
      region,
    );
    console.log(`    Delete connection: ${r.exitCode === 0 ? 'OK' : 'skipped'}`);
  }

  // 5. IAM role cleanup
  if (resources.roleName) {
    // Delete inline policies first
    const listPolicies = await awsCliSafe([
      'iam',
      'list-role-policies',
      '--role-name',
      resources.roleName,
    ]);
    if (listPolicies.exitCode === 0) {
      const policies = JSON.parse(listPolicies.stdout);
      for (const policyName of policies.PolicyNames || []) {
        await awsCliSafe([
          'iam',
          'delete-role-policy',
          '--role-name',
          resources.roleName,
          '--policy-name',
          policyName,
        ]);
      }
    }
    const r = await awsCliSafe(['iam', 'delete-role', '--role-name', resources.roleName]);
    console.log(`    Delete role: ${r.exitCode === 0 ? 'OK' : 'skipped'}`);
  }

  // 6. IAM user cleanup
  if (resources.userName) {
    // Detach managed policies
    const listAttached = await awsCliSafe([
      'iam',
      'list-attached-user-policies',
      '--user-name',
      resources.userName,
    ]);
    if (listAttached.exitCode === 0) {
      const attached = JSON.parse(listAttached.stdout);
      for (const p of attached.AttachedPolicies || []) {
        await awsCliSafe([
          'iam',
          'detach-user-policy',
          '--user-name',
          resources.userName,
          '--policy-arn',
          p.PolicyArn,
        ]);
      }
    }

    // Delete access keys
    const listKeys = await awsCliSafe([
      'iam',
      'list-access-keys',
      '--user-name',
      resources.userName,
    ]);
    if (listKeys.exitCode === 0) {
      const keys = JSON.parse(listKeys.stdout);
      for (const k of keys.AccessKeyMetadata || []) {
        await awsCliSafe([
          'iam',
          'delete-access-key',
          '--user-name',
          resources.userName,
          '--access-key-id',
          k.AccessKeyId,
        ]);
      }
    }

    const r = await awsCliSafe(['iam', 'delete-user', '--user-name', resources.userName]);
    console.log(`    Delete user: ${r.exitCode === 0 ? 'OK' : 'skipped'}`);
  }

  console.log('  Cleanup: Done.');
}
