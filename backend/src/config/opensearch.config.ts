import { registerAs } from '@nestjs/config';

export interface OpenSearchConfig {
  url: string | null;
  username: string | null;
  password: string | null;
}

export const opensearchConfig = registerAs<OpenSearchConfig>('opensearch', () => ({
  url: process.env.OPENSEARCH_URL ?? null,
  username: process.env.OPENSEARCH_USERNAME ?? null,
  password: process.env.OPENSEARCH_PASSWORD ?? null,
}));
