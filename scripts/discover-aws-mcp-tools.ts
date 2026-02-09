#!/usr/bin/env bun
/**
 * Discover tools for AWS MCP servers and populate database
 * 
 * This script:
 * 1. Spins up a temporary container for each AWS MCP server
 * 2. Queries the MCP tools endpoint
 * 3. Updates the database with tool information
 */

const AWS_SERVERS = [
  { name: 'cloudtrail', command: 'awslabs.cloudtrail-mcp-server' },
  { name: 'iam', command: 'awslabs.iam-mcp-server' },
  { name: 's3-tables', command: 'awslabs.s3-tables-mcp-server' },
  { name: 'cloudwatch', command: 'awslabs.cloudwatch-mcp-server' },
  { name: 'aws-network', command: 'awslabs.aws-network-mcp-server' },
  { name: 'lambda', command: 'awslabs.lambda-tool-mcp-server' },
  { name: 'dynamodb', command: 'awslabs.dynamodb-mcp-server' },
  { name: 'aws-documentation', command: 'awslabs.aws-documentation-mcp-server' },
  { name: 'well-architected-security', command: 'awslabs.well-architected-security-mcp-server' },
  { name: 'aws-api', command: 'awslabs.aws-api-mcp-server' },
];

const DOCKER_IMAGE = 'shipsec/mcp-aws-suite:latest';
const GROUP_ID = 'd5adb1c5-6e7f-47d3-b864-66dfe4755679';

async function discoverToolsForServer(serverName: string, command: string) {
  console.log(`\n🔍 Discovering tools for ${serverName}...`);
  
  // Start container
  const containerName = `temp-mcp-${serverName}-${Date.now()}`;
  
  // Start container in background
  const startProcess = Bun.spawn([
    'docker', 'run', '-d', '--rm',
    '--name', containerName,
    '-e', 'MCP_COMMAND=' + command,
    '-e', 'AWS_ACCESS_KEY_ID=test',
    '-e', 'AWS_SECRET_ACCESS_KEY=test',
    '-e', 'AWS_REGION=us-east-1',
    '-p', '0:8080',  // Random host port
    DOCKER_IMAGE
  ], { stdout: 'pipe', stderr: 'pipe' });
  
  await startProcess.exited;
  const containerId = (await startProcess.stdout.text()).trim();
  
  if (!containerId) {
    console.error(`  ❌ Failed to start container`);
    return null;
  }
  
  // Get the mapped port
  const portProcess = Bun.spawn([
    'docker', 'port', containerName, '8080'
  ], { stdout: 'pipe', stderr: 'pipe' });
  
  await portProcess.exited;
  const portOutput = await portProcess.stdout.text();
  const portMatch = portOutput.match(/0.0.0.0:(\d+)/);
  
  if (!portMatch) {
    console.error(`  ❌ Failed to get port`);
    await Bun.spawn(['docker', 'stop', containerId]).exited;
    return null;
  }
  
  const port = portMatch[1];
  const endpoint = `http://localhost:${port}/mcp`;
  
  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Try to list tools
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const tools = data.result?.tools || [];
    
    console.log(`  ✅ Found ${tools.length} tools`);
    
    // Clean up container
    await Bun.spawn(['docker', 'stop', containerId]).exited;
    
    return {
      serverName,
      command,
      tools: tools.map((t: any) => ({
        toolName: t.name,
        description: t.description?.substring(0, 5000), // Truncate long descriptions
        inputSchema: t.inputSchema,
      })),
    };
  } catch (error) {
    console.error(`  ❌ Error: ${error}`);
    await Bun.spawn(['docker', 'stop', containerId]).exited;
    return null;
  }
}

async function main() {
  console.log('🚀 Starting AWS MCP tool discovery...\n');
  
  const results = [];
  
  for (const server of AWS_SERVERS) {
    const result = await discoverToolsForServer(server.name, server.command);
    if (result) {
      results.push(result);
    }
  }
  
  console.log('\n\n📊 Discovery complete!');
  console.log(`   Total servers: ${AWS_SERVERS.length}`);
  console.log(`   Successful: ${results.length}`);
  console.log(`   Failed: ${AWS_SERVERS.length - results.length}`);
  
  console.log('\n📝 Tool counts:');
  for (const result of results) {
    console.log(`   ${result.serverName}: ${result.tools.length} tools`);
  }
  
  // Save to file for database update
  await Bun.write(
    '/tmp/aws-mcp-tools-discovery.json',
    JSON.stringify(results, null, 2)
  );
  
  console.log('\n💾 Results saved to /tmp/aws-mcp-tools-discovery.json');
}

main().catch(console.error);
