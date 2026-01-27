import { Client } from '@opensearch-project/opensearch';
import { config } from 'dotenv';

// Load environment variables
config();

async function main() {
  const url = process.env.OPENSEARCH_URL;
  const username = process.env.OPENSEARCH_USERNAME;
  const password = process.env.OPENSEARCH_PASSWORD;

  if (!url) {
    console.error('❌ OPENSEARCH_URL environment variable is required');
    process.exit(1);
  }

  console.log('🔍 Connecting to OpenSearch...');

  const client = new Client({
    node: url,
    auth: username && password ? { username, password } : undefined,
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });

  try {
    // Test connection
    const healthCheck = await client.cluster.health();
    console.log(`✅ Connected to OpenSearch cluster (status: ${healthCheck.body.status})`);

    // Create index template for security-findings-*
    const templateName = 'security-findings-template';
    console.log(`\n📋 Creating index template: ${templateName}`);

    await client.indices.putIndexTemplate({
      name: templateName,
      body: {
        index_patterns: ['security-findings-*'],
        template: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
          },
          mappings: {
            properties: {
              '@timestamp': {
                type: 'date',
              },
              workflow_id: {
                type: 'keyword',
              },
              workflow_name: {
                type: 'keyword',
              },
              run_id: {
                type: 'keyword',
              },
              node_ref: {
                type: 'keyword',
              },
              component_id: {
                type: 'keyword',
              },
              asset_key: {
                type: 'keyword',
              },
              data: {
                type: 'object',
                dynamic: true,
              },
            },
          },
        },
      },
    });

    console.log(`✅ Index template '${templateName}' created successfully`);
    console.log('\n📊 Template configuration:');
    console.log('  - Index pattern: security-findings-*');
    console.log('  - Shards: 1, Replicas: 1');
    console.log('  - Mappings: @timestamp (date), workflow_id (keyword), workflow_name (keyword),');
    console.log('              run_id (keyword), node_ref (keyword), component_id (keyword),');
    console.log('              asset_key (keyword), data (object with dynamic: true)');
    console.log('\n🎉 OpenSearch setup completed successfully!');
  } catch (error) {
    console.error('❌ OpenSearch setup failed');
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error during OpenSearch setup');
  console.error(error);
  process.exit(1);
});
