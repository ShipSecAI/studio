import type { ConsoleMessage, Page } from '@playwright/test';

// Benign errors to ignore
const BENIGN_PATTERNS = [
  'favicon.ico',
  'React DevTools',
  'Vite HMR',
  '[HMR]',
  'Download the React DevTools',
  'net::ERR_',
  'the server responded with a status of 404',
];

export class ConsoleMonitor {
  private errors: string[] = [];
  private listening = false;

  constructor(private page: Page) {}

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.page.on('console', this.handleMessage);
  }

  stop(): void {
    this.page.off('console', this.handleMessage);
    this.listening = false;
  }

  reset(): void {
    this.errors = [];
  }

  private handleMessage = (msg: ConsoleMessage): void => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const isBenign = BENIGN_PATTERNS.some((p) => text.includes(p));
    if (!isBenign) {
      this.errors.push(text);
    }
  };

  getErrors(): string[] {
    return [...this.errors];
  }

  assertNoErrors(): void {
    if (this.errors.length > 0) {
      const details = this.errors.map((e) => `  - ${e}`).join('\n');
      throw new Error(`Console errors detected:\n${details}`);
    }
  }
}
