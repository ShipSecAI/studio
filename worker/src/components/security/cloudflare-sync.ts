import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  analyticsResultSchema,
} from '@shipsec/component-sdk';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

const inputSchema = inputs({
  cloudflareToken: port(z.string(), {
    label: 'Cloudflare API Token',
    description: 'Cloudflare API token with Zone:Read and DNS:Read permissions.',
  }),
});

const outputSchema = outputs({
  synced: port(z.boolean(), {
    label: 'Synced',
    description: 'Whether the Cloudflare sync completed successfully.',
  }),
  zoneCount: port(z.number(), {
    label: 'Zone Count',
    description: 'Number of Cloudflare zones synced.',
  }),
  recordCount: port(z.number(), {
    label: 'Record Count',
    description: 'Total DNS records synced.',
  }),
  resolvedCount: port(z.number(), {
    label: 'Resolved Count',
    description: 'Number of DNS records linked to existing cloud resources.',
  }),
  results: port(z.array(analyticsResultSchema()).optional(), {
    label: 'Results',
    description: 'Analytics results for indexing.',
  }),
});

type AnalyticsResult = z.infer<ReturnType<typeof analyticsResultSchema>>;

const parameterSchema = parameters({
  cloudflareApiToken: param(
    z.string().optional().describe('Cloudflare API token (bypasses integration lookup).'),
    { label: 'API Token (Direct)', editor: 'text' },
  ),
  zonesPerPage: param(z.number().int().min(1).max(50).default(50).describe('Zones per API page.'), {
    label: 'Zones Per Page',
    editor: 'number',
  }),
  recordsPerPage: param(
    z.number().int().min(1).max(500).default(500).describe('DNS records per API page.'),
    { label: 'Records Per Page', editor: 'number' },
  ),
  resolveAwsResources: param(
    z
      .boolean()
      .default(true)
      .describe('Attempt to link DNS CNAME/A records to existing AWS resources in Neo4j.'),
    { label: 'Resolve AWS Resources', editor: 'boolean' },
  ),
  failOnError: param(
    z
      .boolean()
      .default(false)
      .describe('Strict mode: fail the workflow if Cloudflare API calls fail.'),
    { label: 'Fail on Error', editor: 'boolean' },
  ),
});

interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  type: string;
  development_mode: number;
  name_servers: string[];
  original_name_servers: string[];
  original_registrar: string;
  original_dnshost: string;
  created_on: string;
  modified_on: string;
  activated_on: string;
  account: { id: string; name: string };
}

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxiable: boolean;
  proxied: boolean;
  ttl: number;
  locked: boolean;
  zone_id: string;
  zone_name: string;
  created_on: string;
  modified_on: string;
  comment: string | null;
  tags: string[];
}

async function fetchCloudflare<T>(endpoint: string, token: string): Promise<T> {
  const url = `${CLOUDFLARE_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Cloudflare API error ${response.status} on ${endpoint}: ${body.slice(0, 500)}`,
    );
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(
      `Cloudflare API error on ${endpoint}: ${JSON.stringify(json.errors).slice(0, 500)}`,
    );
  }

  return json.result as T;
}

async function fetchAllPages<T>(endpoint: string, token: string, perPage: number): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const paged = `${endpoint}${sep}per_page=${perPage}&page=${page}`;
    const batch = await fetchCloudflare<T[]>(paged, token);
    if (!batch || batch.length === 0) break;
    results.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return results;
}

function escapeCypherLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_|_$/g, '');
}

function deriveAwsOriginType(content: string): string | null {
  if (content.includes('.elb.') || content.includes('.elb-')) return 'ELB';
  if (content.includes('.compute.amazonaws.com')) return 'EC2_INSTANCE';
  if (content.includes('.rds.amazonaws.com')) return 'RDS';
  if (content.includes('.s3.') || content.includes('.s3-website')) return 'S3';
  if (content.includes('cloudfront.net')) return 'CLOUDFRONT';
  if (content.includes('api-gateway') || content.includes('execute-api')) return 'APIGATEWAY';
  return null;
}

function findHostnameOrIpProperty(target: string): { property: string; value: string } | null {
  const trimmed = target.toLowerCase().trim();
  // CNAME often points to AWS hostnames like *.elb.amazonaws.com or *.compute.amazonaws.com
  if (trimmed.endsWith('.')) {
    const withoutDot = trimmed.slice(0, -1);
    return { property: 'dnsname', value: withoutDot };
  }
  // IPv4 check
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) {
    return { property: 'publicipaddress', value: trimmed };
  }
  return { property: 'dnsname', value: trimmed };
}

const definition = defineComponent({
  id: 'security.cloudflare.sync',
  label: 'Cloudflare Sync',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Syncs Cloudflare zones and DNS records into the Neo4j graph. Resolves DNS CNAME/A records to AWS resources (ELB, EC2, RDS, S3, CloudFront, API Gateway) already present in the graph, creating edges that link external attack surface to internal cloud inventory.',
  ui: {
    slug: 'cloudflare-sync',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Ingest Cloudflare DNS records into the asset graph and link them to cloud resources for attack-surface-to-infrastructure mapping.',
    icon: 'Cloud',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
    examples: [
      'Map Cloudflare proxied domains to the AWS ELB or EC2 instances they route to.',
      'Identify which DNS records point to cloud resources missing from inventory.',
    ],
  },
  async execute(payload: any, context) {
    const parsedInputs = inputSchema.parse(payload.inputs);
    const parsedParams = parameterSchema.parse(payload.params);
    const token = parsedInputs.cloudflareToken || parsedParams.cloudflareApiToken || '';
    if (!token.trim()) {
      context.logger.error('[CloudflareSync] No Cloudflare API token provided');
      if (parsedParams.failOnError) throw new Error('Cloudflare API token required');
      return { synced: false, zoneCount: 0, recordCount: 0, resolvedCount: 0, results: [] };
    }
    let zoneCount = 0;
    let recordCount = 0;
    let resolvedCount = 0;

    try {
      // 1. Fetch all zones
      const zones = await fetchAllPages<CloudflareZone>('/zones', token, parsedParams.zonesPerPage);
      zoneCount = zones.length;
      context.logger.info(`[CloudflareSync] Fetched ${zoneCount} zone(s) from Cloudflare`);

      if (zoneCount === 0) {
        return { synced: true, zoneCount: 0, recordCount: 0, resolvedCount: 0, results: [] };
      }

      // 2. Connect to Neo4j
      const neo4jUri = process.env.NEO4J_URI?.trim() || 'bolt://localhost:7687';
      const neo4jDatabase = process.env.NEO4J_DATABASE?.trim() || 'neo4j';
      const neo4jUser = process.env.NEO4J_USER?.trim() || '';
      const neo4jPassword = process.env.NEO4J_PASSWORD?.trim() || '';
      const { default: neo4j } = await import('neo4j-driver');

      const driver = neo4j.driver(
        neo4jUri,
        neo4jUser && neo4jPassword ? neo4j.auth.basic(neo4jUser, neo4jPassword) : undefined,
        { disableLosslessIntegers: true },
      );
      const session = driver.session({ database: neo4jDatabase });

      const analyticsResults: AnalyticsResult[] = [];

      try {
        for (const zone of zones) {
          const zoneId = `cloudflare:zone:${zone.id}`;

          // MERGE the zone node
          await session.run(
            `MERGE (z:CloudflareZone:CloudflareResource {id: $id})
             ON CREATE SET z += $props, z.firstseen = timestamp()
             ON MATCH SET z += $update, z.lastupdated = timestamp()`,
            {
              id: zoneId,
              props: {
                name: zone.name,
                status: zone.status,
                paused: zone.paused,
                zone_type: zone.type,
                nameservers: zone.name_servers,
                original_registrar: zone.original_registrar,
                cf_zone_id: zone.id,
              },
              update: {
                name: zone.name,
                status: zone.status,
                paused: zone.paused,
              },
            },
          );

          // 3. Fetch all DNS records for this zone
          const records = await fetchAllPages<CloudflareDnsRecord>(
            `/zones/${zone.id}/dns_records`,
            token,
            parsedParams.recordsPerPage,
          );
          recordCount += records.length;

          context.logger.debug(
            `[CloudflareSync] Zone ${zone.name} has ${records.length} DNS record(s)`,
          );

          for (const record of records) {
            const recordId = `cloudflare:dns:${record.id}`;
            const recordLabel = escapeCypherLabel(record.type);

            // MERGE the DNS record node
            await session.run(
              `MATCH (z:CloudflareZone {id: $zoneId})
               MERGE (r:CloudflareDNSRecord:${recordLabel}Record:CloudflareResource {id: $recordId})
               ON CREATE SET r += $props, r.firstseen = timestamp()
               ON MATCH SET r += $update, r.lastupdated = timestamp()
               MERGE (r)-[:BELONGS_TO_ZONE]->(z)`,
              {
                zoneId,
                recordId,
                props: {
                  name: record.name,
                  record_type: record.type,
                  content: record.content,
                  proxied: record.proxied,
                  proxiable: record.proxiable,
                  ttl: record.ttl,
                  zone_name: record.zone_name,
                  cf_record_id: record.id,
                  comment: record.comment,
                },
                update: {
                  content: record.content,
                  proxied: record.proxied,
                  ttl: record.ttl,
                },
              },
            );

            // 4. Attempt to resolve DNS record to AWS resources
            if (
              parsedParams.resolveAwsResources &&
              (record.type === 'CNAME' || record.type === 'A') &&
              record.content
            ) {
              const awsType = deriveAwsOriginType(record.content);
              const match = findHostnameOrIpProperty(record.content);

              let linked = false;
              let matchedLabel = 'unknown';
              let matchedProperty = '';

              if (awsType === 'ELB') {
                const result = await session.run(
                  `MATCH (lb:LoadBalancer) WHERE lb.dnsname = $value OR lb.dnsname STARTS WITH $value
                   RETURN labels(lb) as labels, lb.dnsname as dnsname, lb.name as name
                   LIMIT 1`,
                  { value: match!.value },
                );
                if (result.records.length > 0) {
                  const rec = result.records[0];
                  matchedLabel = (rec.get('labels') as string[])[0] || 'LoadBalancer';
                  matchedProperty = rec.get('dnsname') as string;
                  await session.run(
                    `MATCH (z:CloudflareDNSRecord {id: $recordId})
                     MATCH (r:${matchedLabel} {dnsname: $dnsname})
                     MERGE (z)-[:RESOLVES_TO {type: 'dns'}]->(r)`,
                    { recordId, dnsname: matchedProperty },
                  );
                  linked = true;
                }
              }

              if (!linked && awsType === 'EC2_INSTANCE') {
                const result = await session.run(
                  `MATCH (e:EC2Instance) WHERE e.publicdnsname = $value OR e.publicipaddress = $ip
                   RETURN labels(e) as labels, e.publicipaddress as ip, e.instanceid as id
                   LIMIT 1`,
                  {
                    value: match!.value,
                    ip: match!.property === 'publicipaddress' ? match!.value : '',
                  },
                );
                if (result.records.length > 0) {
                  const rec = result.records[0];
                  matchedLabel = 'EC2Instance';
                  matchedProperty = (rec.get('ip') || rec.get('id')) as string;
                  await session.run(
                    `MATCH (z:CloudflareDNSRecord {id: $recordId})
                     MATCH (r:EC2Instance {instanceid: $instanceId})
                     MERGE (z)-[:RESOLVES_TO {type: 'dns'}]->(r)`,
                    { recordId, instanceId: rec.get('id') as string },
                  );
                  linked = true;
                }
              }

              if (!linked && awsType === 'S3') {
                const bucketName = record.content
                  .replace(/\.s3[\w.-]*\.amazonaws\.com.*/, '')
                  .split('.')[0];
                const result = await session.run(
                  `MATCH (b:S3Bucket) WHERE b.name = $name
                   RETURN labels(b) as labels, b.name as name
                   LIMIT 1`,
                  { name: bucketName },
                );
                if (result.records.length > 0) {
                  await session.run(
                    `MATCH (z:CloudflareDNSRecord {id: $recordId})
                     MATCH (r:S3Bucket {name: $name})
                     MERGE (z)-[:RESOLVES_TO {type: 'dns'}]->(r)`,
                    { recordId, name: bucketName },
                  );
                  linked = true;
                  matchedLabel = 'S3Bucket';
                  matchedProperty = bucketName;
                }
              }

              if (!linked && awsType === 'RDS') {
                const result = await session.run(
                  `MATCH (r:RDSInstance) WHERE r.dnsname = $value
                   RETURN labels(r) as labels, r.dnsname as dnsname LIMIT 1`,
                  { value: match!.value },
                );
                if (result.records.length > 0) {
                  await session.run(
                    `MATCH (z:CloudflareDNSRecord {id: $recordId})
                     MATCH (r:RDSInstance {dnsname: $dnsname})
                     MERGE (z)-[:RESOLVES_TO {type: 'dns'}]->(r)`,
                    { recordId, dnsname: match!.value },
                  );
                  linked = true;
                  matchedLabel = 'RDSInstance';
                  matchedProperty = match!.value;
                }
              }

              if (!linked && awsType === 'CLOUDFRONT') {
                const distDomain = record.content.replace(/\.cloudfront\.net.*/, '');
                const result = await session.run(
                  `MATCH (d:CloudFrontDistribution) WHERE d.domainname CONTAINS $domain
                   RETURN labels(d) as labels, d.domainname as domain LIMIT 1`,
                  { domain: distDomain },
                );
                if (result.records.length > 0) {
                  await session.run(
                    `MATCH (z:CloudflareDNSRecord {id: $recordId})
                     MATCH (r:CloudFrontDistribution {domainname: $domain})
                     MERGE (z)-[:RESOLVES_TO {type: 'dns'}]->(r)`,
                    { recordId, domain: result.records[0].get('domain') as string },
                  );
                  linked = true;
                  matchedLabel = 'CloudFrontDistribution';
                  matchedProperty = result.records[0].get('domain') as string;
                }
              }

              if (!linked && awsType === 'APIGATEWAY') {
                const result = await session.run(
                  `MATCH (a:APIGatewayRestApi) WHERE a.dnsname = $value
                   RETURN labels(a) as labels, a.dnsname as dnsname LIMIT 1`,
                  { value: match!.value },
                );
                if (result.records.length > 0) {
                  await session.run(
                    `MATCH (z:CloudflareDNSRecord {id: $recordId})
                     MATCH (r:APIGatewayRestApi {dnsname: $dnsname})
                     MERGE (z)-[:RESOLVES_TO {type: 'dns'}]->(r)`,
                    { recordId, dnsname: match!.value },
                  );
                  linked = true;
                  matchedLabel = 'APIGatewayRestApi';
                  matchedProperty = match!.value;
                }
              }

              if (linked) resolvedCount++;

              // Analytics result for this record
              analyticsResults.push({
                scanner: 'cloudflare',
                finding_hash: `cf-dns-${record.id.slice(0, 12)}`,
                severity: 'info',
                asset_key: record.name,
                title: linked
                  ? `DNS ${record.type} ${record.name} → ${matchedLabel}`
                  : `DNS ${record.type} ${record.name} → ${record.content}`,
                description: linked
                  ? `Resolved to ${matchedLabel}:${matchedProperty}`
                  : awsType
                    ? `Unresolved ${awsType} target: ${record.content}`
                    : `Target: ${record.content}`,
                provider: 'cloudflare',
                account_id: zone.account.id,
                service_name: 'Cloudflare',
                region: 'global',
                status: linked ? 'RESOLVED' : 'UNRESOLVED',
                cloudflare_zone: zone.name,
                cloudflare_record_type: record.type,
                cloudflare_content: record.content,
                cloudflare_proxied: record.proxied,
                aws_resource_type: awsType || 'unknown',
                resolved: linked,
              });
            }
          }
        }
      } finally {
        await session.close();
        await driver.close();
      }

      context.logger.info(
        `[CloudflareSync] Synced ${zoneCount} zone(s), ${recordCount} record(s), resolved ${resolvedCount} AWS resource links`,
      );

      return {
        synced: true,
        zoneCount,
        recordCount,
        resolvedCount,
        results: analyticsResults,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error(`[CloudflareSync] Sync failed: ${message}`);

      if (parsedParams.failOnError) throw error;

      return {
        synced: false,
        zoneCount,
        recordCount,
        resolvedCount,
        results: [],
      };
    }
  },
});

componentRegistry.register(definition);
