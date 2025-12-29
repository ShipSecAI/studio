import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MigrationGuard } from './migration.guard';
import * as schema from './schema';

export const DRIZZLE_TOKEN = Symbol('DRIZZLE_CONNECTION');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: Pool,
      useFactory: () => {
        if (process.env.SKIP_INGEST_SERVICES === 'true') {
          return {
            connect: async () => ({
              query: async () => ({ rows: [] }),
              release: () => {},
            }),
            on: () => {},
          } as unknown as Pool;
        }
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error('DATABASE_URL is not set');
        }
        return new Pool({ connectionString });
      },
    },
    {
      provide: DRIZZLE_TOKEN,
      useFactory: (pool: Pool) => {
        if (process.env.SKIP_INGEST_SERVICES === 'true') {
          // Recursive mock that handles method chaining and awaits
          const createRecursiveMock = (): any => {
            return new Proxy(() => {}, {
              get: (target, prop) => {
                if (prop === 'then') {
                  // When awaited, resolve to empty array (safe for most db queries)
                  return (resolve: any) => resolve([]);
                }
                return createRecursiveMock();
              },
              apply: () => {
                return createRecursiveMock();
              },
            });
          };
          return createRecursiveMock();
        }
        // Pass schema to enable relational query API (db.query.tableName)
        return drizzle(pool, { schema });
      },
      inject: [Pool],
    },
    MigrationGuard,
  ],
  exports: [DRIZZLE_TOKEN],
})
export class DatabaseModule {}
