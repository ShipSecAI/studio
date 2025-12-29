# End-to-End (E2E) Tests

This directory contains E2E tests that validate the workflow execution system with real backend, worker, and infrastructure components.

## Testing Framework

**Bun Test Runner** - E2E tests use Bun's built-in test framework (`bun:test`).

### Why Bun's Test Runner?

1. **Native to Bun**: No additional dependencies - already using Bun in the project
2. **Simple & Fast**: Perfect for API/workflow E2E testing without overhead
3. **Full TypeScript Support**: `tsconfig.e2e.json` provides proper type checking
4. **Familiar API**: `describe`, `test`, `expect` - similar to Jest/Vitest
5. **Async/Await Support**: Built-in support for async operations and polling
6. **CI/CD Ready**: Proper exit codes, test discovery, and reporting

### Test Structure

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

describe('Feature Name', () => {
  beforeAll(async () => {
    // Setup: Verify services, seed data, etc.
  });

  afterAll(async () => {
    // Teardown: Cleanup reminders, log output
  });

  test('Specific scenario', async () => {
    // Arrange: Create test data, setup workflow

    // Act: Execute workflow, poll for completion

    // Assert: Verify status, traces, artifacts
    expect(result).toBe(expected);
  });
});
```

### Running Tests

See "Running Tests" section below for command-line instructions.

## Prerequisites

**Required: Local development environment must be running**

```bash
# Start infrastructure (Temporal, Postgres, MinIO, Loki)
docker compose -p shipsec up -d

# Start backend API and worker (PM2)
pm2 start pm2.config.cjs

# Or start services individually
bun --cwd backend run dev
bun --cwd worker run dev
```

### Verify Services

- Backend API: http://localhost:3211/api/v1/health (returns `{"status":"ok"}`)
- Temporal UI: http://localhost:7233 (optional, for debugging workflows)
- Postgres: localhost:5432 (internal)
- MinIO: http://localhost:9000 (optional, for artifacts)

## Running Tests

### Using Just (Recommended)

```bash
# Run all tests
just test

# Run specific test
just run-error-handling

# Clean up test artifacts
just cleanup
```

### Using Bun Test Runner Directly

```bash
# Run all tests (using E2E tsconfig)
bun test --config tsconfig.e2e.json e2e-tests/

# Run specific test
bun test --config tsconfig.e2e.json e2e-tests/error-handling.test.ts
```

### Using Just from Root Directory

```bash
# From project root, use --working-directory flag
just --working-directory e2e-tests test
```

## Test Descriptions

### error-handling.test.ts

Validates that error handling refactor across different error types and retry scenarios.

**Testing Framework**: Uses Bun's built-in test runner (`bun:test`) with proper test structure (`describe`, `test`, `expect`).

**Configuration**: E2E tests use a separate tsconfig (`tsconfig.e2e.json`) to avoid conflicts with workspace builds.

**Note**: Test workflows are created with a prefix "Test: " for easy cleanup.

#### Test Scenarios:

1. **Permanent Service Error**
   - Throws `ServiceError` on every attempt
   - Verifies max retry policy is enforced (default: 3 attempts)
   - Confirms error details are preserved with attempt tracking
   - Expected: Workflow **COMPLETES successfully** on attempt 4 (exceeds default maxAttempts of 3)
   - Note: `failUntilAttempt: 4` = fails 1-3, succeeds on 4
   - Duration: ~31 seconds (exponential backoff: 1+2+4+8 = 15s)

2. **Retryable Success**
   - Throws `ServiceError` for first 2 attempts
   - Succeeds on attempt 3
   - Validates exponential backoff behavior
   - Confirms progress events are emitted
   - Expected: Workflow completes successfully
   - Duration: ~7 seconds (1+2+4s)

3. **Validation Error Details**
   - Throws `ValidationError` with field errors
   - Validates non-retryable error behavior (fails immediately)
   - Confirms structured field errors are preserved (api_key, region)
   - Expected: Workflow fails immediately with 1 attempt only
   - Duration: <2 seconds

4. **Timeout Error**
   - Throws `TimeoutError` with timeout duration
   - Validates retryable error behavior (retries on timeout)
   - Confirms timeout metadata is preserved
   - Expected: Workflow completes after 4 attempts
   - Duration: ~15 seconds (1+2+4+8s)

#### What This Test Validates:

- ✅ Error types correctly thrown from components
- ✅ Errors propagate through Temporal workflow execution
- ✅ Error details (type, message, structured data) preserved
- ✅ Retry policy honored (max attempts, backoff)
- ✅ Non-retryable errors (ValidationError) fail immediately
- ✅ Retryable errors (ServiceError, TimeoutError) follow backoff
- ✅ Error events recorded in traces with full metadata
- ✅ Attempt tracking in error details (currentAttempt, targetAttempt)
- ✅ Field errors for ValidationError preserved correctly

#### Output Format:

```
🧪 E2E Test Suite: Error Handling
  Prerequisites: Backend API + Worker must be running
  Verifying services...
  ✅ Backend API is running

e2e-tests/error-handling.test.ts:

  Test: Permanent Service Error - fails with max retries (2.34s)
  Workflow ID: <uuid>
  Run ID: shipsec-run-<uuid>
  Status: FAILED
  Error attempts: 5
  ✓ expect(result.status).toBe('FAILED')
  ✓ expect(errorEvents.length).toBeGreaterThan(0)
  ✓ expect(lastError.error.type).toBe('ServiceError')
  ...
  1 pass, 0 fail
```

## Test Components

### test.error.generator

Test component used by E2E tests to simulate various error scenarios.

**Note**: This component is NOT hidden in production - it should be used only for testing.

**Parameters**:
- `mode` (enum): 'success' | 'fail' - Whether to succeed or fail
- `errorType` (string): Error class to throw (e.g., 'ServiceError', 'ValidationError')
- `errorMessage` (string): Custom error message
- `errorDetails` (object): Structured error details (e.g., fieldErrors)
- `failUntilAttempt` (number): Keep failing until this attempt (exclusive)
- `alwaysFail` (boolean): Always fail regardless of attempt count

**Examples**:

```typescript
// Fails once (ValidationError - non-retryable)
{
  mode: 'fail',
  errorType: 'ValidationError',
  errorMessage: 'Invalid parameters',
  failUntilAttempt: 1,
  alwaysFail: true,
  errorDetails: {
    fieldErrors: {
      api_key: ['Invalid format'],
      region: ['Unsupported region']
    }
  }
}

// Fails 2 times, succeeds on 3rd (retryable)
{
  mode: 'fail',
  errorType: 'ServiceError',
  errorMessage: 'Transient failure',
  failUntilAttempt: 3
}

// Always fails (max retries)
{
  mode: 'fail',
  errorType: 'ServiceError',
  errorMessage: 'Permanent failure',
  failUntilAttempt: 10
}
```

## Troubleshooting

### Test Fails with "Connection Refused"

**Problem**: Backend or worker not running.

**Solution**: Start services with `pm2 start pm2.config.cjs` or check logs with `pm2 logs`.

### Test Fails with "Component not found"

**Problem**: Worker not registered test-error-generator component.

**Solution**: Restart worker to reload component registry:
```bash
pm2 restart shipsec-worker
```

### Test Gets Stuck on "Status: RUNNING"

**Problem**: Workflow execution hanging or worker not processing tasks.

**Solution**: Check worker logs for errors:
```bash
pm2 logs worker --nostream --lines 50
```

### Test Shows "Run ID: undefined"

**Problem**: Workflow run creation failed due to validation errors.

**Solution**: Check backend logs for validation errors and ensure workflow schema is valid.

## Adding New Tests

1. Create new test file: `e2e-tests/<test-name>.test.ts`
2. Follow the pattern from `error-handling.test.ts`:
   ```typescript
   import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

   const API_BASE = 'http://localhost:3211/api/v1';
   const HEADERS = {
     'Content-Type': 'application/json',
     'x-internal-token': 'local-internal-token',
   };

   describe('Feature Name', () => {
     test('Test scenario', async () => {
       // Arrange: Create test data

       // Act: Execute workflow

       // Assert: Verify results
       expect(result).toBe(expected);
     });
   });
   ```
3. Important conventions:
   - Prefix workflow names with "Test: " for cleanup (`name: \`Test: ${name}\``)
   - Use `beforeAll()` for setup (service health checks)
   - Use `afterAll()` for cleanup reminders
   - Use `expect()` assertions from Bun's test framework
   - Set reasonable timeouts for polling (180s default)
4. Update README.md with test description
5. Add test command to justfile:
   ```just
   run-<test-name>:
       @bun test --config tsconfig.e2e.json e2e-tests/<test-name>.test.ts
   ```

## Cleanup

Use `just cleanup` to remove test artifacts (workflow runs, test workflows):

```bash
just cleanup
```

This removes all workflows with the "Test: " prefix created during testing to keep the workspace clean.
