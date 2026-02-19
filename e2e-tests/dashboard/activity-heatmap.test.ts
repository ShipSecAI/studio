import { expect } from 'bun:test';
import { e2eDescribe, e2eTest, API_BASE, HEADERS } from '../helpers/e2e-harness';

e2eDescribe('Activity Heatmap — GET /runs/activity', () => {
  e2eTest('returns 200 with correct schema (default 90 days)', async () => {
    const res = await fetch(`${API_BASE}/workflows/runs/activity`, {
      headers: HEADERS,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('totalRuns');
    expect(data).toHaveProperty('activity');
    expect(typeof data.totalRuns).toBe('number');
    expect(Array.isArray(data.activity)).toBe(true);

    // Each activity entry should have date and count
    for (const entry of data.activity) {
      expect(typeof entry.date).toBe('string');
      expect(typeof entry.count).toBe('number');
      expect(entry.count).toBeGreaterThan(0);
    }
  });

  e2eTest('respects days query parameter', async () => {
    const res = await fetch(`${API_BASE}/workflows/runs/activity?days=30`, {
      headers: HEADERS,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('totalRuns');
    expect(data).toHaveProperty('activity');

    // All dates should be within last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    for (const entry of data.activity) {
      const entryDate = new Date(entry.date);
      expect(entryDate.getTime()).toBeGreaterThanOrEqual(cutoff.getTime() - 86_400_000);
    }
  });

  e2eTest('rejects invalid days parameter', async () => {
    const res = await fetch(`${API_BASE}/workflows/runs/activity?days=3`, {
      headers: HEADERS,
    });
    // days min is 7, so 3 should fail validation
    expect(res.status).toBe(400);
  });
});
