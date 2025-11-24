#!/bin/bash

echo "🔍 Worker Resource Monitoring Started"
echo "===================================="
echo "Time,Worker PID,CPU%,Memory(mb),Status"
echo "===================================="

while true; do
    TIMESTAMP=$(date '+%H:%M:%S')
    WORKER_STATS=$(bunx pm2 show shipsec-worker --no-daemon --json | jq -r '[.pid, .monit.cpu, .monit.memory] | @csv' 2>/dev/null)

    if [ -n "$WORKER_STATS" ] && [ "$WORKER_STATS" != "null" ]; then
        # Convert memory to MB
        MEM_KB=$(echo "$WORKER_STATS" | cut -d',' -f3)
        MEM_MB=$((MEM_KB / 1024))

        echo "$TIMESTAMP,shipsec-worker,$(echo "$WORKER_STATS" | cut -d',' -f2),$MEM_MB,monitoring"
    else
        echo "$TIMESTAMP,shipsec-worker,0,0,no-data"
    fi

    sleep 1
done