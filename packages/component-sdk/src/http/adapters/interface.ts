import type { HarTimings } from '../types';

export interface IHttpTimingAdapter {
  startTracking(correlationId: string, url: string): void;
  stopTracking(correlationId: string): Partial<HarTimings>;
  dispose(): void;
}

export class NoOpTimingAdapter implements IHttpTimingAdapter {
  startTracking(): void {}

  stopTracking(): Partial<HarTimings> {
    return {
      blocked: -1,
      dns: -1,
      connect: -1,
      ssl: -1,
      send: -1,
      wait: -1,
      receive: -1,
    };
  }

  dispose(): void {}
}
