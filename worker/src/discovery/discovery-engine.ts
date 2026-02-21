import type { DiscoveryProvider, DiscoveryContext, DiscoveryPage } from './discovery-provider';
import { AwsCompositeProvider } from './aws-composite-provider';
import { EcrServiceProvider } from './providers/ecr.provider';
import { IamServiceProvider } from './providers/iam.provider';
import { S3ServiceProvider } from './providers/s3.provider';
import { Ec2ServiceProvider } from './providers/ec2.provider';
import { Route53ServiceProvider } from './providers/route53.provider';
import { LambdaServiceProvider } from './providers/lambda.provider';
import { EksServiceProvider } from './providers/eks.provider';
import { RdsServiceProvider } from './providers/rds.provider';
import { CloudFrontServiceProvider } from './providers/cloudfront.provider';
import { ElbServiceProvider } from './providers/elb.provider';
import { VpcServiceProvider } from './providers/vpc.provider';

/**
 * Discovery engine — registry of providers with dispatch logic.
 */
export class DiscoveryEngine {
  private providers = new Map<string, DiscoveryProvider>();

  constructor() {
    // Register AWS composite provider with all service sub-providers
    const aws = new AwsCompositeProvider();
    // Tier 1 providers (high security impact)
    aws.registerService(new IamServiceProvider());
    aws.registerService(new S3ServiceProvider());
    aws.registerService(new Ec2ServiceProvider());
    aws.registerService(new Route53ServiceProvider());
    aws.registerService(new LambdaServiceProvider());
    aws.registerService(new EcrServiceProvider());
    // Tier 2 providers (important for full posture)
    aws.registerService(new EksServiceProvider());
    aws.registerService(new RdsServiceProvider());
    aws.registerService(new CloudFrontServiceProvider());
    aws.registerService(new ElbServiceProvider());
    aws.registerService(new VpcServiceProvider());
    this.register(aws);
  }

  register(provider: DiscoveryProvider): void {
    this.providers.set(provider.provider, provider);
  }

  getProvider(providerName: string): DiscoveryProvider | undefined {
    return this.providers.get(providerName);
  }

  getAwsCompositeProvider(): AwsCompositeProvider | undefined {
    return this.providers.get('aws') as AwsCompositeProvider | undefined;
  }

  async discover(
    providerName: string,
    context: DiscoveryContext,
    cursor?: string,
  ): Promise<DiscoveryPage> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Discovery provider '${providerName}' not registered`);
    }
    return provider.discover(context, cursor);
  }
}

/** Singleton instance for use in activities */
let engineInstance: DiscoveryEngine | undefined;

export function getDiscoveryEngine(): DiscoveryEngine {
  if (!engineInstance) {
    engineInstance = new DiscoveryEngine();
  }
  return engineInstance;
}
