/**
 * Seed script: imports the AWS CSPM Org Discovery workflow via the backend API.
 *
 * Usage:
 *   bun backend/scripts/seed-aws-cspm-workflow.ts
 *
 * The backend must be running on BACKEND_URL (default http://localhost:3001).
 * Set ADMIN_USERNAME / ADMIN_PASSWORD env vars if admin auth is required,
 * or CLERK_SESSION_TOKEN for Clerk-based auth.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const ADMIN_USER = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? 'admin';

async function main() {
  const workflowPath = resolve(import.meta.dir, '../../docs/sample/aws-cspm-org-discovery.json');

  const workflowJson = JSON.parse(readFileSync(workflowPath, 'utf-8'));
  console.log(`Importing workflow: ${workflowJson.name}`);
  console.log(`  Nodes: ${workflowJson.nodes.length}`);
  console.log(`  Edges: ${workflowJson.edges.length}`);

  // Build auth headers — try Clerk token first, then fall back to basic auth
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.CLERK_SESSION_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.CLERK_SESSION_TOKEN}`;
  } else {
    headers['Authorization'] = `Basic ${btoa(`${ADMIN_USER}:${ADMIN_PASS}`)}`;
  }

  const res = await fetch(`${BACKEND_URL}/api/v1/workflows`, {
    method: 'POST',
    headers,
    body: JSON.stringify(workflowJson),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed to create workflow (${res.status}): ${body}`);
    process.exit(1);
  }

  const created = await res.json();
  console.log(`\nWorkflow created successfully!`);
  console.log(`  ID: ${created.id}`);
  console.log(`  Name: ${created.name}`);
  console.log(`  Version: ${created.currentVersion}`);
  console.log(`\nOpen in dashboard: http://localhost:5173/workflows/${created.id}`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
