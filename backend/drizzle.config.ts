import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema',
  out: './drizzle',
  dbCredentials: {
    url: connectionString,
  },
});
