import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export const DRIZZLE_TOKEN = Symbol('DRIZZLE_CONNECTION');

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
  ],
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
  ],
  exports: [DRIZZLE_TOKEN],
})
export class DatabaseModule {}
