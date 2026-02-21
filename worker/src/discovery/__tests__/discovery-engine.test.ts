import { describe, it, expect } from 'bun:test';
import { DiscoveryEngine, getDiscoveryEngine } from '../discovery-engine';

describe('DiscoveryEngine', () => {
  it('registers and retrieves the AWS composite provider', () => {
    const engine = new DiscoveryEngine();
    const provider = engine.getProvider('aws');
    expect(provider).toBeDefined();
    expect(provider!.provider).toBe('aws');
  });

  it('exposes AWS composite provider via getAwsCompositeProvider', () => {
    const engine = new DiscoveryEngine();
    const composite = engine.getAwsCompositeProvider();
    expect(composite).toBeDefined();
  });

  it('includes Tier 1, 2, and 3 asset types', () => {
    const engine = new DiscoveryEngine();
    const composite = engine.getAwsCompositeProvider()!;
    const types = composite.assetTypes;

    // Tier 1
    expect(types).toContain('iam_user');
    expect(types).toContain('s3_bucket');
    expect(types).toContain('ec2_instance');
    expect(types).toContain('lambda_function');
    expect(types).toContain('ecr_repository');

    // Tier 2
    expect(types).toContain('eks_cluster');
    expect(types).toContain('rds_instance');
    expect(types).toContain('cloudfront_distribution');

    // Tier 3
    expect(types).toContain('secretsmanager_secret');
    expect(types).toContain('kms_key');
    expect(types).toContain('ecs_cluster');
    expect(types).toContain('acm_certificate');
    expect(types).toContain('cloudtrail_trail');
    expect(types).toContain('guardduty_detector');
    expect(types).toContain('sns_topic');
    expect(types).toContain('sqs_queue');
    expect(types).toContain('dynamodb_table');
    expect(types).toContain('elasticache_cluster');
    expect(types).toContain('apigateway_rest_api');
    expect(types).toContain('apigateway_http_api');
  });

  it('throws for unknown provider', async () => {
    const engine = new DiscoveryEngine();
    await expect(
      engine.discover('gcp', {
        integrationId: 'x',
        organizationId: 'x',
        credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
        accountIdentifier: 'x',
        regions: [],
      }),
    ).rejects.toThrow("Discovery provider 'gcp' not registered");
  });

  it('getDiscoveryEngine returns a singleton', () => {
    const a = getDiscoveryEngine();
    const b = getDiscoveryEngine();
    expect(a).toBe(b);
  });
});
