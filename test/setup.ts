// Provide test defaults so the backend env validation doesn't throw when
// AppModule is imported by integration/e2e tests that skip actual execution.
// NOTE: We intentionally set dummy values instead of SKIP_INGEST_SERVICES=true
// so that DatabaseModule / ingest modules keep their real behaviour and
// integration tests that import AppModule exercise real code paths.
if (!process.env.SECRET_STORE_MASTER_KEY) {
  process.env.SECRET_STORE_MASTER_KEY = 'aaaaaaaaaabbbbbbbbbbccccccccccdd';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
}
if (!process.env.LOG_KAFKA_BROKERS) {
  process.env.LOG_KAFKA_BROKERS = 'localhost:9092';
}

import '../frontend/src/test/setup.ts'
