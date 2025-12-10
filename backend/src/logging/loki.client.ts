export interface LokiLogClientConfig {
  baseUrl: string;
  tenantId?: string;
  username?: string;
  password?: string;
}

export interface LokiStreamLine {
  message: string;
  timestamp: Date;
}

export class LokiLogClient {
  constructor(private readonly config: LokiLogClientConfig) {}

  async push(labels: Record<string, string>, lines: LokiStreamLine[]): Promise<void> {
    if (lines.length === 0) {
      return;
    }

    const url = this.resolveUrl('/loki/api/v1/push');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.tenantId) {
      headers['X-Scope-OrgID'] = this.config.tenantId;
    }

    if (this.config.username && this.config.password) {
      const credentials = Buffer.from(
        `${this.config.username}:${this.config.password}`,
      ).toString('base64');
      headers.Authorization = `Basic ${credentials}`;
    }

    const body = JSON.stringify({
      streams: [
        {
          stream: labels,
          values: lines.map((line) => [this.toNanoseconds(line.timestamp), line.message]),
        },
      ],
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Loki push failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }
  }

  private resolveUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private toNanoseconds(date: Date): string {
    return (BigInt(date.getTime()) * 1000000n).toString();
  }
}
