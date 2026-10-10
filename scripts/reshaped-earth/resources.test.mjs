import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceStopReason } from './resources.mjs';
const baseline = {
  peakRSS: 0.7 * 1024 ** 3,
  swapMiB: 8000,
  swapBaselineMiB: 7000,
  critical: false,
  seconds: 120,
};
test('unattributed machine swap growth alone does not stop a small job', () => {
  assert.equal(resourceStopReason({ ...baseline, swapMiB: 16000 }), null);
});
test('resource limits stop an oversized process or combined memory growth', () => {
  assert.match(
    resourceStopReason({ ...baseline, peakRSS: 4 * 1024 ** 3 + 1 }),
    /4 GiB/,
  );
  assert.equal(
    resourceStopReason({ ...baseline, peakRSS: 3 * 1024 ** 3 }),
    null,
  );
  assert.match(
    resourceStopReason({ ...baseline, peakRSS: 3 * 1024 ** 3, swapMiB: 8025 }),
    /swap grew/,
  );
  assert.match(resourceStopReason({ ...baseline, critical: true }), /critical/);
  assert.match(
    resourceStopReason({ ...baseline, seconds: 1801 }),
    /30 minutes/,
  );
});
