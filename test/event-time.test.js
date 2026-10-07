import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventTime } from '../src/lib/event-time.js';

test('Moscow event time is saved as the same instant regardless of server timezone', () => {
  assert.equal(parseEventTime({ event_date: '2026-10-17', event_time: '12:00' }).toISOString(), '2026-10-17T09:00:00.000Z');
  assert.equal(parseEventTime({ starts_at: '2026-10-17T12:00' }).toISOString(), '2026-10-17T09:00:00.000Z');
  assert.equal(parseEventTime({ event_date: '2026-10-17', event_time: '00:30' }).toISOString(), '2026-10-16T21:30:00.000Z');
  assert.ok(Number.isNaN(parseEventTime({}).getTime()));
});
