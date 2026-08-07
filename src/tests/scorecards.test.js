import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fieldPlacements } from '../core/scorecards.js';

test('fieldPlacements returns only the primary geometry when pairing is disabled', () => {
    const field = { fromLeftMm: 10, fromTopMm: 20, widthMm: 60, heightMm: 15, pair: { enabled: false } };
    const placements = fieldPlacements(field);
    assert.equal(placements.length, 1);
    assert.deepEqual(placements[0], { fromLeftMm: 10, fromTopMm: 20, widthMm: 60, heightMm: 15 });
});

test('fieldPlacements adds an offset copy when pairing is enabled', () => {
    const field = {
        fromLeftMm: 10,
        fromTopMm: 20,
        widthMm: 60,
        heightMm: 15,
        pair: { enabled: true, horizontalOffsetMm: 100, verticalOffsetMm: 5 },
    };
    const placements = fieldPlacements(field);
    assert.equal(placements.length, 2);
    assert.deepEqual(placements[1], { fromLeftMm: 110, fromTopMm: 25, widthMm: 60, heightMm: 15 });
});

test('fieldPlacements treats missing offsets as 0', () => {
    const field = { fromLeftMm: 10, fromTopMm: 20, widthMm: 60, heightMm: 15, pair: { enabled: true } };
    const placements = fieldPlacements(field);
    assert.deepEqual(placements[1], { fromLeftMm: 10, fromTopMm: 20, widthMm: 60, heightMm: 15 });
});
