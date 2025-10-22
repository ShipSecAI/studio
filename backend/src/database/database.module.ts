import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MigrationGuard } from './migration.guard';

export const DRIZZLE_TOKEN = Symbol('DRIZZLE_CONNECTION');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: Pool,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error('DATABASE_URL is not set');
        }
        return new Pool({ connectionString });
      },
    },
    {
      provide: DRIZZLE_TOKEN,
      useFactory: (pool: Pool) => drizzle(pool),
      inject: [Pool],
    },
    MigrationGuard,
  ],
  exports: [DRIZZLE_TOKEN],
})
export class DatabaseModule {}
