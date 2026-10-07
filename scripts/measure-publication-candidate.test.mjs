import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeResources,
  median,
  validateMeasurementResult,
  validateRepeatability,
} from './measure-publication-candidate.mjs';

function sample(detail) {
  return {
    readinessObservation: {
      startedAtMs: 10,
      globeUsableObservedAtMs: 80,
      bilateralIndexObservedAtMs: 120,
      mode: 'concurrent-condition-polling',
    },
    geonames: {
      requestCount: 1,
      decodedReadyMs: 120,
      asset: {
        name: '/mundus/geonames.json',
        startTimeMs: 20,
        responseEndMs: 100,
        transferBytes: 10,
      },
      firstFocus: { focusAtMs: 130, searchReadyMs: 135, focusToReadyMs: 5 },
    },
    vector: { detail, asset: `/mundus/${detail}.mvg` },
    failures: {
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
    },
    warnings: [],
    duplicateFetches: [],
  };
}

function result() {
  return {
    schemaVersion: 3,
    executionIdentity: 'execution-one',
    scenarioIdentity: 'mundus-v1.1-publication-candidate-v3',
    gitHead: '79c0f67d0595c4c83e07016f147af80c0ff76a45',
    environment: {
      playwrightChromium: '149.0.7827.55',
      networkEmulation: 'none',
      mountPath: '/mundus/',
    },
    buildIdentity: { assets: [{ path: 'a.js', sha256: 'one' }] },
    scenarios: {
      desktop: {
        context: {
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
        },
        samples: Array.from({ length: 3 }, () => sample('50m')),
      },
      pixel7: {
        context: {
          viewport: { width: 412, height: 839 },
          deviceScaleFactor: 2.625,
        },
        samples: Array.from({ length: 3 }, () => sample('110m')),
      },
    },
  };
}

test('median handles odd and even samples without mutating input', () => {
  const odd = [9, 1, 5];
  assert.equal(median(odd), 5);
  assert.deepEqual(odd, [9, 1, 5]);
  assert.equal(median([8, 2, 4, 6]), 5);
});

test('measurement validation accepts cold GeoNames invariants', () => {
  assert.doesNotThrow(() => validateMeasurementResult(result()));
});

test('measurement validation requires independently observed concurrent readiness conditions', () => {
  const measured = result();
  measured.scenarios.desktop.samples[0].readinessObservation.mode =
    'sequential';
  assert.throws(
    () => validateMeasurementResult(measured),
    /readiness conditions were not observed concurrently/u,
  );

  measured.scenarios.desktop.samples[0].readinessObservation.mode =
    'concurrent-condition-polling';
  measured.scenarios.desktop.samples[0].readinessObservation.globeUsableObservedAtMs = 9;
  assert.throws(
    () => validateMeasurementResult(measured),
    /globe readiness observation predates observation start/u,
  );
});

test('measurement validation requires one cold GeoNames request before decoded readiness', () => {
  const measured = result();
  measured.scenarios.desktop.samples[0].geonames.requestCount = 2;
  assert.throws(
    () => validateMeasurementResult(measured),
    /desktop sample 1 expected one GeoNames request, observed 2/u,
  );

  measured.scenarios.desktop.samples[0].geonames.requestCount = 1;
  measured.scenarios.desktop.samples[0].geonames.decodedReadyMs = 90;
  assert.throws(
    () => validateMeasurementResult(measured),
    /decoded GeoNames before its response completed/u,
  );
});

test('measurement validation keeps first-focus readiness separate from cold load', () => {
  const measured = result();
  measured.scenarios.pixel7.samples[1].geonames.firstFocus.searchReadyMs = 125;
  assert.throws(
    () => validateMeasurementResult(measured),
    /warm search became ready before first focus/u,
  );
});

test('measurement validation requires stable identities and expected profiles', () => {
  const measured = result();
  measured.scenarios.pixel7.samples[2].vector.detail = '50m';
  assert.throws(
    () => validateMeasurementResult(measured),
    /pixel7 sample 3 selected 50m, expected 110m/u,
  );
});

test('measurement validation rejects errors, failed requests, and duplicate fetches but permits warnings', () => {
  for (const [field, value, message] of [
    ['consoleErrors', ['console failure'], /console errors/u],
    ['pageErrors', ['page failure'], /page errors/u],
    ['requestFailures', [{ url: '/failed' }], /failed requests/u],
  ]) {
    const measured = result();
    measured.scenarios.desktop.samples[0].failures = {
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
      [field]: value,
    };
    measured.scenarios.desktop.samples[0].warnings = ['known warning'];
    measured.scenarios.desktop.samples[0].duplicateFetches = [];
    assert.throws(() => validateMeasurementResult(measured), message);
  }

  const duplicated = result();
  duplicated.scenarios.pixel7.samples[1].failures = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  };
  duplicated.scenarios.pixel7.samples[1].warnings = ['known warning'];
  duplicated.scenarios.pixel7.samples[1].duplicateFetches = [
    { path: '/duplicate.js', count: 2 },
  ];
  assert.throws(
    () => validateMeasurementResult(duplicated),
    /unexpected duplicate asset fetches/u,
  );
});

test('measurement validation requires explicit failure and duplicate arrays', () => {
  const fields = [
    ['failures', 'consoleErrors'],
    ['failures', 'pageErrors'],
    ['failures', 'requestFailures'],
    [null, 'duplicateFetches'],
  ];
  for (const [parent, field] of fields) {
    for (const invalid of [undefined, null, {}, 'none']) {
      const measured = result();
      const target = measured.scenarios.desktop.samples[0];
      if (parent) target[parent][field] = invalid;
      else target[field] = invalid;
      assert.throws(
        () => validateMeasurementResult(measured),
        new RegExp(`${field} must be an explicit array`, 'u'),
      );
    }
  }
});

test('repeatability validation accepts distinct compatible executions with different timings', () => {
  const first = result();
  const second = structuredClone(first);
  second.executionIdentity = 'execution-two';
  second.scenarios.desktop.samples[0].geonames.decodedReadyMs = 140;
  assert.doesNotThrow(() => validateRepeatability(first, second));
});

test('repeatability validation strictly validates both inputs', () => {
  const first = result();
  const second = structuredClone(first);
  second.executionIdentity = 'execution-two';
  delete first.scenarios.desktop.samples[0].failures.consoleErrors;
  assert.throws(
    () => validateRepeatability(first, second),
    /consoleErrors must be an explicit array/u,
  );

  const validFirst = result();
  delete second.scenarios.pixel7.samples[0].duplicateFetches;
  assert.throws(
    () => validateRepeatability(validFirst, second),
    /duplicateFetches must be an explicit array/u,
  );
});

test('repeatability validation rejects the same execution identity', () => {
  const first = result();
  assert.throws(
    () => validateRepeatability(first, structuredClone(first)),
    /Execution identities must be distinct/u,
  );
});

test('repeatability validation rejects schema and build identity changes', () => {
  const first = result();
  const second = structuredClone(first);
  second.executionIdentity = 'execution-two';
  second.schemaVersion = 4;
  assert.throws(
    () => validateRepeatability(first, second),
    /Unexpected schema version/u,
  );
  second.schemaVersion = 3;
  second.buildIdentity.assets[0].sha256 = 'two';
  assert.throws(
    () => validateRepeatability(first, second),
    /Build asset identity changed/u,
  );
});

test('repeatability validation rejects mismatched head, environment, and scenario context', () => {
  const cases = [
    ['gitHead', (value) => (value.gitHead = 'different'), /Git HEAD changed/u],
    [
      'environment',
      (value) => (value.environment.playwrightChromium = '150.0'),
      /Measurement environment changed/u,
    ],
    [
      'scenario context',
      (value) => (value.scenarios.pixel7.context.deviceScaleFactor = 3),
      /pixel7 scenario context changed/u,
    ],
  ];
  for (const [, mutate, message] of cases) {
    const first = result();
    const second = structuredClone(first);
    second.executionIdentity = 'execution-two';
    mutate(second);
    assert.throws(() => validateRepeatability(first, second), message);
  }
});

test('cleanup attempts every resource even when an earlier close fails', async () => {
  const closed = [];
  await assert.rejects(
    closeResources([
      { close: async () => closed.push('page') },
      {
        close: async () => {
          closed.push('context');
          throw new Error('context close failed');
        },
      },
      { close: async () => closed.push('browser') },
    ]),
    /Failed to close 1 measurement resource/u,
  );
  assert.deepEqual(closed, ['page', 'context', 'browser']);
});
