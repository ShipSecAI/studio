# Troubleshooting

Common issues and their resolutions for local development.

## Credential Resolution 404 — "Connection was not found"

**Symptom**: Workflow runs fail with:

```
Failed to resolve credentials for connection <uuid>: {"message":"Connection <uuid> was not found","error":"Not Found","statusCode":404}
```

**Cause**: A Temporal schedule references a connection ID that no longer exists in the database. This happens when an integration connection is deleted and re-created (e.g., re-adding an AWS account), but existing schedules still reference the old connection UUID.

**Diagnosis**:

```bash
# Find schedules referencing the stale connection ID
docker exec shipsec-postgres psql -U shipsec -d shipsec -c \
  "SELECT id, name, status, input_payload::text FROM workflow_schedules
   WHERE input_payload::text LIKE '%<stale-connection-uuid>%';"

# Verify the current valid connection ID
curl -s -u admin:admin http://localhost:3211/api/v1/integrations/connections | python3 -m json.tool
```

**Fix**: Delete and re-create the schedule from the UI so it picks up the new connection ID.

## Backend Restart Loop (bun --watch)

**Symptom**: `pm2 status` shows the backend with high restart count (`↺ 20+`) and only seconds of uptime. `curl localhost:3211` intermittently returns "Connection refused".

**Cause**: The backend runs with `bun --watch`, which restarts the process on any file change. Mutagen file sync can trigger rapid restarts when many files change at once (e.g., after a `git pull` or branch switch).

**Diagnosis**:

```bash
pm2 status                          # Check restart count and uptime
pm2 logs shipsec-backend-0 --err --lines 20 --nostream  # Check for actual errors vs watch restarts
```

**Fix**: Wait for file sync to settle. If the backend stabilizes after a few seconds, the restarts were caused by file changes, not crashes. If it keeps crashing, check the error logs for the actual exception.

## KafkaJS TimeoutNegativeWarning

**Symptom**: Backend stderr shows:

```
TimeoutNegativeWarning: -1772505281417 is a negative number.
Timeout duration was set to 1.
```

**Cause**: Known KafkaJS issue with timeout value overflow. This is a **non-fatal warning** — it does not crash the process. If the backend is also restarting, the restarts are likely from `bun --watch` (see above), not this warning.

**Fix**: No action needed. The warning is harmless.
