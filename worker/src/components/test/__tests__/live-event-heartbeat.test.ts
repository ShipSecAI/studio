import { describe, expect, it } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@shipsec/component-sdk';

import '../live-event-heartbeat';

describe('test.live.event.heartbeat component', () => {
  it('emits heartbeat events on the requested cadence', async () => {
    const component = componentRegistry.get('test.live.event.heartbeat');
    expect(component).toBeDefined();

    const recordedEvents: unknown[] = [];
    const context = createExecutionContext({
      runId: 'run-live-heartbeat',
      componentRef: 'live-heartbeat',
      trace: {
        record(event) {
          recordedEvents.push(event);
        },
      },
    });

    const execPromise = component!.execute(
      {
        label: 'Diagnostics',
        durationSeconds: 5,
        intervalSeconds: 5,
        annotations: { source: 'unit-test' },
      },
      context,
    );

    const result = await execPromise;

    expect(result.summary.label).toBe('Diagnostics');
    expect(result.summary.totalEvents).toBe(1);
    expect(recordedEvents.length).toBeGreaterThanOrEqual(result.summary.totalEvents);
    const heartbeatEvent = recordedEvents.find((event) => (event as any).data?.annotations);
    expect(heartbeatEvent).toBeDefined();
    expect((heartbeatEvent as any).data.annotations).toEqual({ source: 'unit-test' });
  });
});
