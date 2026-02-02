// Use non-prefixed imports for Webpack compatibility (Temporal workflow bundling)
import { subscribe, unsubscribe } from 'diagnostics_channel';
import { performance } from 'perf_hooks';

import type { HarTimings } from '../types';
import type { IHttpTimingAdapter } from './interface';

type TimingData = {
  start: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
  url?: string;
};

export class UndiciTimingAdapter implements IHttpTimingAdapter {
  private static readonly REQUEST_CREATE_CHANNEL = 'undici:request:create';
  private static readonly REQUEST_HEADERS_CHANNEL = 'undici:request:headers';
  private readonly timings = new Map<string, TimingData>();
  private readonly correlationQueueByUrl = new Map<string, string[]>();
  private readonly correlationByRequest = new WeakMap<object, string>();

  private readonly handleRequestCreate = (message: unknown) => {
    const payload = message as Record<string, unknown>;
    const request = payload.request as object | undefined;
    const origin = typeof payload.origin === 'string' ? payload.origin : undefined;
    const path = typeof payload.path === 'string' ? payload.path : undefined;

    if (!request || !origin || !path) {
      return;
    }

    const url = `${origin}${path}`;
    const correlationId = this.dequeueCorrelationId(url);
    if (!correlationId) {
      return;
    }

    this.correlationByRequest.set(request, correlationId);
    const timing = this.timings.get(correlationId);
    if (timing && timing.requestStart === undefined) {
      timing.requestStart = performance.now();
    }
  };

  private readonly handleRequestHeaders = (message: unknown) => {
    const payload = message as Record<string, unknown>;
    const request = payload.request as object | undefined;
    if (!request) {
      return;
    }

    const correlationId = this.correlationByRequest.get(request);
    if (!correlationId) {
      return;
    }

    const timing = this.timings.get(correlationId);
    if (timing && timing.responseStart === undefined) {
      timing.responseStart = performance.now();
    }
  };

  constructor() {
    subscribe(UndiciTimingAdapter.REQUEST_CREATE_CHANNEL, this.handleRequestCreate);
    subscribe(UndiciTimingAdapter.REQUEST_HEADERS_CHANNEL, this.handleRequestHeaders);
  }

  startTracking(correlationId: string, url: string): void {
    this.timings.set(correlationId, { start: performance.now(), url });
    const queue = this.correlationQueueByUrl.get(url) ?? [];
    queue.push(correlationId);
    this.correlationQueueByUrl.set(url, queue);
  }

  stopTracking(correlationId: string): Partial<HarTimings> {
    const timing = this.timings.get(correlationId);
    if (!timing) {
      return {};
    }

    timing.responseEnd = performance.now();

    if (timing.url) {
      const queue = this.correlationQueueByUrl.get(timing.url);
      if (queue) {
        this.correlationQueueByUrl.set(
          timing.url,
          queue.filter((id) => id !== correlationId),
        );
      }
    }

    this.timings.delete(correlationId);

    const blocked = timing.requestStart ? Math.max(0, timing.requestStart - timing.start) : -1;
    const wait =
      timing.responseStart && timing.requestStart
        ? Math.max(0, timing.responseStart - timing.requestStart)
        : -1;
    const receive =
      timing.responseStart && timing.responseEnd
        ? Math.max(0, timing.responseEnd - timing.responseStart)
        : -1;

    return {
      blocked,
      dns: -1,
      connect: -1,
      ssl: -1,
      send: timing.requestStart ? 0 : -1,
      wait,
      receive,
    };
  }

  dispose(): void {
    unsubscribe(UndiciTimingAdapter.REQUEST_CREATE_CHANNEL, this.handleRequestCreate);
    unsubscribe(UndiciTimingAdapter.REQUEST_HEADERS_CHANNEL, this.handleRequestHeaders);
    this.timings.clear();
    this.correlationQueueByUrl.clear();
  }

  private dequeueCorrelationId(url: string): string | undefined {
    const queue = this.correlationQueueByUrl.get(url);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const correlationId = queue.shift();
    if (queue.length === 0) {
      this.correlationQueueByUrl.delete(url);
    } else {
      this.correlationQueueByUrl.set(url, queue);
    }
    return correlationId;
  }
}
