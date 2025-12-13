import { Pool } from 'pg';

async function main() {
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log('🗑️  Starting deletion of all workflow runs and related data...\n');

    // Delete in order: related tables first, then workflow_runs
    const tables = [
      { name: 'workflow_traces', query: 'DELETE FROM workflow_traces' },
      { name: 'workflow_terminal_records', query: 'DELETE FROM workflow_terminal_records' },
      { name: 'workflow_log_streams', query: 'DELETE FROM workflow_log_streams' },
      { name: 'agent_trace_events', query: 'DELETE FROM agent_trace_events' },
      { name: 'artifacts', query: 'DELETE FROM artifacts' },
      { name: 'workflow_runs', query: 'DELETE FROM workflow_runs' },
    ];

    await client.query('BEGIN');

    for (const { name, query } of tables) {
      const result = await client.query(query);
      console.log(`✅ Deleted ${result.rowCount} rows from ${name}`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Successfully deleted all workflow runs and related data');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to delete workflow runs');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Script encountered an unexpected error');
  console.error(error);
  process.exit(1);
});

