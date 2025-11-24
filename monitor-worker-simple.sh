#!/bin/bash

echo "🔍 Worker Resource Monitoring (Simple Mode)"
echo "=========================================="
echo "Test Started: $(date)"
echo "Baseline:"
bunx pm2 list | grep "shipsec-worker" | awk '{print "PID:", $6, "CPU:", $12, "Memory:", $13}'
echo ""

# Function to get worker stats
get_worker_stats() {
    local timestamp=$(date '+%H:%M:%S')
    local stats=$(bunx pm2 list --no-daemon | grep "shipsec-worker" | awk '{print $6 "," $12 "," $13}')
    echo "$timestamp,$stats"
}

# Monitor during test
echo "Monitoring during test execution..."
get_worker_stats

# Run multiple tests quickly
for i in {1..3}; do
    echo ""
    echo "🧪 Running Test #$i at $(date)"
    bun run .playground/terminal-stream-smoke.ts > /dev/null 2>&1
    echo "✅ Test #$i completed at $(date)"
    get_worker_stats
done

echo ""
echo "📊 Final Worker Stats:"
bunx pm2 list | grep "shipsec-worker" | awk '{print "PID:", $6, "CPU:", $12, "Memory:", $13}'
echo "Test Completed: $(date)"