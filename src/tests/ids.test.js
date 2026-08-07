import { test } from 'node:test';
import assert from 'node:assert/strict';

import { uuid7 } from '../core/ids.js';

const sampleRandomBytes = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa];

test('uuid7 matches the canonical UUIDv7 shape', () => {
    const id = uuid7(1700000000000, sampleRandomBytes);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('uuid7 encodes nowMs in the first 48 bits', () => {
    const nowMs = 1700000000000;
    const id = uuid7(nowMs, sampleRandomBytes);
    const hex = id.replace(/-/g, '');
    assert.equal(parseInt(hex.slice(0, 12), 16), nowMs);
});

test('uuid7 is deterministic for the same inputs', () => {
    const first = uuid7(1700000000000, sampleRandomBytes);
    const second = uuid7(1700000000000, sampleRandomBytes);
    assert.equal(first, second);
});

test('uuid7 changes when randomBytes changes', () => {
    const otherRandomBytes = [0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66];
    const first = uuid7(1700000000000, sampleRandomBytes);
    const second = uuid7(1700000000000, otherRandomBytes);
    assert.notEqual(first, second);
});
