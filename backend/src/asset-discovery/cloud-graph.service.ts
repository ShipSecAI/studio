import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import { createHash } from 'node:crypto';

interface AssetTypeConfig {
  labels: string[];
  externalIdCandidates: string[];
  nameCandidates: string[];
  regionCandidates: string[];
  accountCandidates: string[];
  firstSeenCandidates?: string[];
  lastSeenCandidates?: string[];
}

export interface GraphAssetSnapshot {
  id: string;
  organizationId: string;
  integrationId: string | null;
  provider: string;
  assetType: string;
  externalId: string;
  name: string | null;
  region: string | null;
  accountIdentifier: string | null;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
}

const AWS_ASSET_TYPE_CONFIG: Record<string, AssetTypeConfig> = {
  iam_user: {
    labels: ['AWSUser'],
    externalIdCandidates: ['arn', 'id', 'userid', 'name'],
    nameCandidates: ['name', 'username', 'id'],
    regionCandidates: [],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdate'],
    lastSeenCandidates: ['lastupdated', 'passwordlastused'],
  },
  iam_role: {
    labels: ['AWSRole'],
    externalIdCandidates: ['arn', 'roleid', 'id', 'name'],
    nameCandidates: ['name', 'rolename', 'id'],
    regionCandidates: [],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdate'],
    lastSeenCandidates: ['lastupdated'],
  },
  iam_policy: {
    labels: ['AWSPolicy'],
    externalIdCandidates: ['arn', 'id', 'policyid', 'name'],
    nameCandidates: ['name', 'policyname', 'id'],
    regionCandidates: [],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  iam_group: {
    labels: ['AWSGroup'],
    externalIdCandidates: ['arn', 'id', 'groupid', 'name'],
    nameCandidates: ['name', 'groupname', 'id'],
    regionCandidates: [],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdate'],
    lastSeenCandidates: ['lastupdated'],
  },
  s3_bucket: {
    labels: ['S3Bucket'],
    externalIdCandidates: ['arn', 'bucketarn', 'id', 'name'],
    nameCandidates: ['name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'creationdate'],
    lastSeenCandidates: ['lastupdated'],
  },
  ec2_instance: {
    labels: ['EC2Instance'],
    externalIdCandidates: ['arn', 'instanceid', 'id'],
    nameCandidates: ['name', 'instanceid', 'id'],
    regionCandidates: ['region', 'availabilityzone'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'launchtime'],
    lastSeenCandidates: ['lastupdated'],
  },
  ec2_security_group: {
    labels: ['EC2SecurityGroup'],
    externalIdCandidates: ['id', 'groupid', 'arn', 'name'],
    nameCandidates: ['name', 'groupname', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  ec2_eip: {
    labels: ['EC2ElasticIP', 'EC2ElasticIPAddress', 'ElasticIPAddress'],
    externalIdCandidates: ['allocationid', 'arn', 'publicip', 'id'],
    nameCandidates: ['publicip', 'allocationid', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  ec2_volume: {
    labels: ['EBSVolume', 'EC2Volume'],
    externalIdCandidates: ['volumeid', 'arn', 'id'],
    nameCandidates: ['name', 'volumeid', 'id'],
    regionCandidates: ['region', 'availabilityzone'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createtime'],
    lastSeenCandidates: ['lastupdated'],
  },
  route53_hosted_zone: {
    labels: ['Route53HostedZone'],
    externalIdCandidates: ['id', 'arn', 'name'],
    nameCandidates: ['name', 'id'],
    regionCandidates: [],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  route53_record: {
    labels: ['Route53Record'],
    externalIdCandidates: ['id', 'recordname', 'fqdn', 'name'],
    nameCandidates: ['recordname', 'fqdn', 'name', 'id'],
    regionCandidates: [],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  lambda_function: {
    labels: ['LambdaFunction'],
    externalIdCandidates: ['arn', 'functionarn', 'id', 'name'],
    nameCandidates: ['name', 'functionname', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'lastmodified'],
    lastSeenCandidates: ['lastupdated', 'lastmodified'],
  },
  ecr_repository: {
    labels: ['ECRRepository'],
    externalIdCandidates: ['arn', 'repositoryuri', 'repositoryname', 'id'],
    nameCandidates: ['repositoryname', 'name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['registryid', 'accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdat'],
    lastSeenCandidates: ['lastupdated'],
  },
  ecr_image: {
    labels: ['ECRImage', 'ECRRepositoryImage'],
    externalIdCandidates: ['arn', 'imageid', 'imagedigest', 'id'],
    nameCandidates: ['name', 'imageid', 'imagedigest', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['registryid', 'accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'imagepushedat'],
    lastSeenCandidates: ['lastupdated'],
  },
  eks_cluster: {
    labels: ['EKSCluster'],
    externalIdCandidates: ['arn', 'name', 'id'],
    nameCandidates: ['name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdat'],
    lastSeenCandidates: ['lastupdated'],
  },
  rds_instance: {
    labels: ['RDSInstance'],
    externalIdCandidates: ['arn', 'dbinstanceidentifier', 'id'],
    nameCandidates: ['dbinstanceidentifier', 'name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'instancecreateTime'],
    lastSeenCandidates: ['lastupdated'],
  },
  rds_cluster: {
    labels: ['RDSCluster'],
    externalIdCandidates: ['arn', 'dbclusteridentifier', 'id'],
    nameCandidates: ['dbclusteridentifier', 'name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  cloudfront_distribution: {
    labels: ['CloudFrontDistribution'],
    externalIdCandidates: ['arn', 'id', 'domainname'],
    nameCandidates: ['domainname', 'id'],
    regionCandidates: [],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'lastmodifiedtime'],
    lastSeenCandidates: ['lastupdated', 'lastmodifiedtime'],
  },
  elb_load_balancer: {
    labels: ['LoadBalancer', 'ELBv2LoadBalancer', 'ELBLoadBalancer'],
    externalIdCandidates: ['arn', 'loadbalancerarn', 'id', 'dnsname'],
    nameCandidates: ['name', 'dnsname', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdtime'],
    lastSeenCandidates: ['lastupdated'],
  },
  elb_target_group: {
    labels: ['TargetGroup', 'ELBTargetGroup'],
    externalIdCandidates: ['arn', 'targetgrouparn', 'id', 'name'],
    nameCandidates: ['name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdtime'],
    lastSeenCandidates: ['lastupdated'],
  },
  vpc: {
    labels: ['AWSVpc', 'VPC'],
    externalIdCandidates: ['vpcid', 'arn', 'id'],
    nameCandidates: ['name', 'vpcid', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  vpc_subnet: {
    labels: ['EC2Subnet', 'Subnet'],
    externalIdCandidates: ['subnetid', 'arn', 'id'],
    nameCandidates: ['name', 'subnetid', 'id'],
    regionCandidates: ['region', 'availabilityzone'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  secretsmanager_secret: {
    labels: ['SecretsManagerSecret'],
    externalIdCandidates: ['arn', 'name', 'id'],
    nameCandidates: ['name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createddate'],
    lastSeenCandidates: ['lastupdated', 'lastchangeddate'],
  },
  kms_key: {
    labels: ['KMSKey'],
    externalIdCandidates: ['arn', 'keyid', 'id'],
    nameCandidates: ['aliasname', 'keyid', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'creationdate'],
    lastSeenCandidates: ['lastupdated'],
  },
  ecs_cluster: {
    labels: ['ECSCluster'],
    externalIdCandidates: ['arn', 'clusterarn', 'id', 'name'],
    nameCandidates: ['name', 'clustername', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  ecs_service: {
    labels: ['ECSService'],
    externalIdCandidates: ['arn', 'servicearn', 'id', 'name'],
    nameCandidates: ['name', 'servicename', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdat'],
    lastSeenCandidates: ['lastupdated'],
  },
  acm_certificate: {
    labels: ['ACMCertificate'],
    externalIdCandidates: ['arn', 'certificatearn', 'id'],
    nameCandidates: ['domainname', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdat'],
    lastSeenCandidates: ['lastupdated'],
  },
  cloudtrail_trail: {
    labels: ['CloudTrailTrail'],
    externalIdCandidates: ['arn', 'trailarn', 'name', 'id'],
    nameCandidates: ['name', 'trailarn', 'id'],
    regionCandidates: ['region', 'homeregion'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  guardduty_detector: {
    labels: ['GuardDutyDetector'],
    externalIdCandidates: ['id', 'detectorid', 'arn'],
    nameCandidates: ['detectorid', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdat'],
    lastSeenCandidates: ['lastupdated'],
  },
  sns_topic: {
    labels: ['SNSTopic'],
    externalIdCandidates: ['arn', 'topicarn', 'name', 'id'],
    nameCandidates: ['name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  sqs_queue: {
    labels: ['SQSQueue'],
    externalIdCandidates: ['arn', 'queueurl', 'name', 'id'],
    nameCandidates: ['name', 'queuename', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createdtimestamp'],
    lastSeenCandidates: ['lastupdated', 'lastmodifiedtimestamp'],
  },
  dynamodb_table: {
    labels: ['DynamoDBTable'],
    externalIdCandidates: ['arn', 'tablename', 'id'],
    nameCandidates: ['tablename', 'name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'creationdate'],
    lastSeenCandidates: ['lastupdated'],
  },
  elasticache_cluster: {
    labels: ['ElastiCacheCluster'],
    externalIdCandidates: ['arn', 'cacheclusterid', 'id'],
    nameCandidates: ['cacheclusterid', 'name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen'],
    lastSeenCandidates: ['lastupdated'],
  },
  apigateway_rest_api: {
    labels: ['APIGatewayRestApi'],
    externalIdCandidates: ['arn', 'id', 'name'],
    nameCandidates: ['name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createddate'],
    lastSeenCandidates: ['lastupdated'],
  },
  apigateway_http_api: {
    labels: ['APIGatewayHttpApi'],
    externalIdCandidates: ['arn', 'id', 'name'],
    nameCandidates: ['name', 'id'],
    regionCandidates: ['region'],
    accountCandidates: ['accountid', 'account_id', 'awsaccountid'],
    firstSeenCandidates: ['firstseen', 'createddate'],
    lastSeenCandidates: ['lastupdated'],
  },
};

const LABEL_TO_ASSET_TYPE = new Map<string, string>(
  Object.entries(AWS_ASSET_TYPE_CONFIG).flatMap(([assetType, config]) =>
    config.labels.map((label) => [label, assetType] as const),
  ),
);

const SUPPORTED_LABELS = Array.from(LABEL_TO_ASSET_TYPE.keys());

const GRAPH_SNAPSHOT_QUERY = `
MATCH (n)
WHERE any(label IN labels(n) WHERE label IN $labels)
RETURN labels(n) AS labels, properties(n) AS props
`;

@Injectable()
export class CloudGraphService implements OnModuleDestroy {
  private readonly logger = new Logger(CloudGraphService.name);
  private driver?: Driver;

  constructor(private readonly configService: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = undefined;
    }
  }

  getDatabaseName(): string {
    return this.configService.get<string>('NEO4J_DATABASE', 'neo4j');
  }

  async listAssets(
    organizationId: string,
    accountIdentifiers: string[],
  ): Promise<GraphAssetSnapshot[]> {
    if (accountIdentifiers.length === 0) {
      return [];
    }

    const database = this.getDatabaseName();
    const session = this.getDriver().session({ database });
    const allowedAccounts = new Set(accountIdentifiers);

    try {
      const result = await session.run(GRAPH_SNAPSHOT_QUERY, { labels: SUPPORTED_LABELS });
      return result.records
        .map((record: any) =>
          this.normalizeNode(
            organizationId,
            toPlainValue(record.get('labels')) as string[],
            toPlainValue(record.get('props')) as Record<string, unknown>,
          ),
        )
        .filter((asset: GraphAssetSnapshot | null): asset is GraphAssetSnapshot => asset !== null)
        .filter(
          (asset) => !!asset.accountIdentifier && allowedAccounts.has(asset.accountIdentifier),
        );
    } finally {
      await session.close();
    }
  }

  async getAssetByKey(
    organizationId: string,
    accountIdentifiers: string[],
    assetType: string,
    externalId: string,
  ): Promise<GraphAssetSnapshot | null> {
    const allAssets = await this.listAssets(organizationId, accountIdentifiers);
    return (
      allAssets.find((asset) => asset.assetType === assetType && asset.externalId === externalId) ??
      null
    );
  }

  private getDriver(): Driver {
    if (this.driver) {
      return this.driver;
    }

    const uri = this.configService.get<string>('NEO4J_URI', 'bolt://localhost:7687');
    const user = this.configService.get<string>('NEO4J_USER', '');
    const password = this.configService.get<string>('NEO4J_PASSWORD', '');
    const auth =
      user.trim().length > 0 && password.trim().length > 0
        ? neo4j.auth.basic(user, password)
        : undefined;

    this.driver = neo4j.driver(uri, auth, {
      disableLosslessIntegers: true,
    });
    return this.driver;
  }

  private normalizeNode(
    organizationId: string,
    labels: string[],
    props: Record<string, unknown>,
  ): GraphAssetSnapshot | null {
    const assetType = labels.map((label) => LABEL_TO_ASSET_TYPE.get(label)).find(Boolean);
    if (!assetType) {
      return null;
    }

    const config = AWS_ASSET_TYPE_CONFIG[assetType];
    const externalId = firstString(props, config.externalIdCandidates) ?? deriveExternalId(props);
    if (!externalId) {
      return null;
    }

    const parsedArn = parseAwsArn(externalId);
    const region =
      normalizeRegion(firstString(props, config.regionCandidates)) ?? parsedArn?.region ?? null;
    const accountIdentifier =
      firstString(props, config.accountCandidates) ?? parsedArn?.accountId ?? null;
    const lastSeenAt = normalizeDate(
      firstScalar(
        props,
        config.lastSeenCandidates ?? [
          'lastupdated',
          'last_seen_at',
          'lastSeenAt',
          'updatedat',
          'updatedAt',
        ],
      ),
    );
    const firstSeenAt = normalizeDate(
      firstScalar(
        props,
        config.firstSeenCandidates ?? [
          'firstseen',
          'first_seen_at',
          'firstSeenAt',
          'createdat',
          'createdAt',
          'lastupdated',
        ],
      ),
    );

    return {
      id: buildGraphAssetId(organizationId, assetType, externalId),
      organizationId,
      integrationId: null,
      provider: 'aws',
      assetType,
      externalId,
      name: firstString(props, config.nameCandidates) ?? null,
      region,
      accountIdentifier,
      metadata: props,
      firstSeenAt,
      lastSeenAt,
    };
  }
}

function buildGraphAssetId(organizationId: string, assetType: string, externalId: string): string {
  const hex = createHash('sha256')
    .update(`${organizationId}:${assetType}:${externalId}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function firstString(props: Record<string, unknown>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const value = props[candidate];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstScalar(props: Record<string, unknown>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const value = props[candidate];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function deriveExternalId(props: Record<string, unknown>): string | null {
  return (
    firstString(props, ['arn', 'id', 'name']) ??
    firstString(props, ['instanceid', 'bucketarn', 'repositoryuri', 'dbinstanceidentifier'])
  );
}

function normalizeRegion(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const zoneMatch = trimmed.match(/^([a-z]{2}-[a-z]+-\d)[a-z]$/);
  if (zoneMatch) {
    return zoneMatch[1];
  }
  return trimmed;
}

function normalizeDate(value: string | null): string {
  if (!value) return new Date(0).toISOString();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return new Date(0).toISOString();
}

function parseAwsArn(value: string): { accountId: string | null; region: string | null } | null {
  if (!value.startsWith('arn:')) {
    return null;
  }
  const parts = value.split(':');
  if (parts.length < 6) {
    return null;
  }
  return {
    region: parts[3] || null,
    accountId: parts[4] || null,
  };
}

function toPlainValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (neo4j.isInt(value)) {
    return neo4j.integer.inSafeRange(value)
      ? neo4j.integer.toNumber(value)
      : neo4j.integer.toString(value);
  }

  if (Array.isArray(value)) {
    return value.map(toPlainValue);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toPlainValue(val);
    }
    return result;
  }

  return value;
}
