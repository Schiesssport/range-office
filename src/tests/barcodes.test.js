import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeChecksum, buildMatchCode, buildParticipantCode } from '../core/barcodes.js';

test('computeChecksum returns a 2-digit string', () => {
    const c = computeChecksum('123456');
    assert.match(c, /^\d{2}$/);
});

test('computeChecksum is deterministic', () => {
    assert.equal(computeChecksum('123456'), computeChecksum('123456'));
});

test('computeChecksum strips non-digits before computing', () => {
    assert.equal(computeChecksum('12-34-56'), computeChecksum('123456'));
});

test('computeChecksum: appended checksum is divisible by 97 (mod-97 invariant)', () => {
    const base = '20123456';
    const cs = computeChecksum(base);
    const full = BigInt(base + cs);
    assert.equal(full % 97n, 0n);
});

test('buildMatchCode returns null when matchCode or targetCode is empty', () => {
    assert.equal(buildMatchCode({ codePrefix: '20', matchCode: '',    targetCode: '001' }), null);
    assert.equal(buildMatchCode({ codePrefix: '20', matchCode: '001', targetCode: ''    }), null);
});

test('buildMatchCode pads parts and appends a 2-digit checksum', () => {
    const code = buildMatchCode({ codePrefix: '2', matchCode: '1', targetCode: '2' });
    assert.equal(code.length, 10);
    assert.equal(code.slice(0, 8), '02001002');
    assert.match(code.slice(8), /^\d{2}$/);
});

test('buildParticipantCode returns null when disabled or license empty', () => {
    assert.equal(buildParticipantCode({ prefix: '10', license: '123', enabled: false }), null);
    assert.equal(buildParticipantCode({ prefix: '10', license: '',    enabled: true  }), null);
    assert.equal(buildParticipantCode({ prefix: '10', license: 'abc', enabled: true  }), null);
});

test('buildParticipantCode pads license to 6 digits and appends checksum', () => {
    const code = buildParticipantCode({ prefix: '10', license: '42', enabled: true });
    assert.equal(code.length, 10);
    assert.equal(code.slice(0, 8), '10000042');
    assert.match(code.slice(8), /^\d{2}$/);
});
