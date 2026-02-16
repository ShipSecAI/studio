// Provide test defaults so the backend env validation doesn't throw when
// AppModule is imported by integration/e2e tests that skip actual execution.
if (!process.env.SECRET_STORE_MASTER_KEY) {
  process.env.SECRET_STORE_MASTER_KEY = 'aaaaaaaaaabbbbbbbbbbccccccccccdd';
}
if (!process.env.SKIP_INGEST_SERVICES) {
  process.env.SKIP_INGEST_SERVICES = 'true';
}

import '../frontend/src/test/setup.ts'
