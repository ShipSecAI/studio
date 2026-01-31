#!/usr/bin/env bun
import * as fs from 'fs';

const DEBUG_LOG_FILE = '/tmp/shipsec-debug/worker.log';

const args = process.argv.slice(2);
const filter = args[0];
const lineCount = parseInt(args[1]) || 50;

if (!fs.existsSync(DEBUG_LOG_FILE)) {
  console.log('No debug logs found at', DEBUG_LOG_FILE);
  process.exit(0);
}

const content = fs.readFileSync(DEBUG_LOG_FILE, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

let filtered = lines;

if (filter) {
  if (filter.includes(':')) {
    const [key, value] = filter.split(':');
    filtered = lines.filter(line => {
      try {
        const json = JSON.parse(line);
        return json[key]?.toString().includes(value);
      } catch {
        return false;
      }
    });
  } else {
    // Filter by substring in message
    filtered = lines.filter(line => {
      try {
        const json = JSON.parse(line);
        return json.message?.toLowerCase().includes(filter.toLowerCase()) ||
               json.context?.toLowerCase().includes(filter.toLowerCase());
      } catch {
        return false;
      }
    });
  }
}

// Get last N lines
const recent = filtered.slice(-lineCount);

console.log(`\n📋 Recent Debug Logs (${recent.length} lines)\n`);
console.log(`Log file: ${DEBUG_LOG_FILE}`);
if (filter) {
  console.log(`Filter: ${filter}`);
}
console.log('-'.repeat(100));

recent.forEach(line => {
  try {
    const entry = JSON.parse(line);
    const time = entry.timestamp?.split('T')[1]?.split('.')[0] || '??:??:??';
    const level = entry.level?.toUpperCase().padEnd(5) || 'INFO ';
    const context = entry.context?.padEnd(30) || 'unknown'.padEnd(30);
    const msg = entry.message || '';
    
    console.log(`${time} [${level}] ${context} ${msg}`);
    
    if (entry.data && typeof entry.data === 'object' && Object.keys(entry.data).length > 0) {
      console.log(`         └─ Data: ${JSON.stringify(entry.data)}`);
    }
  } catch {
    // Malformed line, skip
  }
});

console.log('-'.repeat(100));
console.log(`\nTotal logs in file: ${lines.length}`);
console.log(`Shown: ${recent.length}`);
console.log(`\nUsage: bun scripts/view-debug-logs.ts [filter] [line-count]`);
console.log(`Examples:`);
console.log(`  bun scripts/view-debug-logs.ts                     # Last 50 lines`);
console.log(`  bun scripts/view-debug-logs.ts "tool discovery" 100  # Search for "tool discovery", show 100 lines`);
console.log(`  bun scripts/view-debug-logs.ts "level:error"      # Show only errors\n`);
