// Provide test defaults so backend env validation doesn't throw when
// AppModule is imported by integration/e2e tests that skip actual execution.
// We keep real module behavior enabled so tests still exercise actual paths.
if (!process.env.SECRET_STORE_MASTER_KEY) {
  process.env.SECRET_STORE_MASTER_KEY = 'aaaaaaaaaabbbbbbbbbbccccccccccdd';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
}
if (!process.env.LOG_KAFKA_BROKERS) {
  process.env.LOG_KAFKA_BROKERS = 'localhost:9092';
}

import '../../../frontend/src/test/setup.ts';
