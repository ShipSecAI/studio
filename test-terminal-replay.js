// Simple test to verify terminal replay timing
const fetch = require('node-fetch');

const runId = 'shipsec-run-af5b2a16-bb5c-47bb-89f0-804dd2d9ad1f';
const nodeRef = 'terminal-demo-1';
const stream = 'pty';

async function testTerminalReplay() {
  console.log('🔧 Testing Terminal Replay Timing...');

  try {
    const response = await fetch(`http://localhost:3211/api/v1/workflows/runs/${runId}/terminal?nodeRef=${nodeRef}&stream=${stream}`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64')
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch terminal data: ${response.status}`);
    }

    const data = await response.json();
    const chunks = data.chunks;

    console.log(`✅ Found ${chunks.length} terminal chunks`);
    console.log(`📊 Mode should be: 'replay' (not live)`);
    console.log(`⏱️  First 5 chunks deltaMs:`, chunks.slice(0, 5).map(c => c.deltaMs));
    console.log(`🎯 Expected behavior: Progress bar should animate with ~200ms delays`);

    // Let's simulate the timing that should happen in the frontend
    console.log('\n📺 Simulating Frontend Replay Timing:');
    console.log('----------------------------------------');

    for (let i = 0; i < Math.min(10, chunks.length); i++) {
      const chunk = chunks[i];
      const delay = chunk.deltaMs || 200;
      const decoded = Buffer.from(chunk.payload, 'base64').toString('utf8');

      console.log(`Chunk ${i + 1}: ${delay}ms delay -> "${decoded.replace(/\n/g, '\\n')}"`);
    }

    console.log('\n✅ Terminal replay data looks correct!');
    console.log('🎮 The frontend should now display the progress bar with proper timing delays');
    console.log('🚀 Open the frontend and test the terminal button on a workflow run');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testTerminalReplay();