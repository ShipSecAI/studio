import { registerAs } from '@nestjs/config';

export interface ClickHouseConfig {
  url: string | null;
  database: string;
  username: string | null;
  password: string | null;
}

export const clickhouseConfig = registerAs<ClickHouseConfig>('clickhouse', () => ({
  url: process.env.CLICKHOUSE_URL ?? null,
  database: process.env.CLICKHOUSE_DATABASE ?? 'shipsec',
  username: process.env.CLICKHOUSE_USERNAME ?? null,
  password: process.env.CLICKHOUSE_PASSWORD ?? null,
}));
