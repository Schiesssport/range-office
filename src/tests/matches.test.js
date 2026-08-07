import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLabel, buildPrintPairs, totalPrice } from '../core/matches.js';

test('normalizeLabel trims and caps at 2 characters', () => {
    assert.equal(normalizeLabel('  ab  '), 'ab');
    assert.equal(normalizeLabel('abcdef'), 'ab');
    assert.equal(normalizeLabel(''), '');
    assert.equal(normalizeLabel(undefined), '');
});

const participants = [
    { name: 'A', registeredMatches: ['k1', 'k2'] },
    { name: 'B', registeredMatches: ['k2'] },
];

const matches = [{ key: 'k1' }, { key: 'k2' }];

test('buildPrintPairs for a single match includes only registered participants, in order', () => {
    const pairs = buildPrintPairs(participants, matches, 'k2');
    assert.equal(pairs.length, 2);
    assert.equal(pairs[0].participant.name, 'A');
    assert.equal(pairs[0].match.key, 'k2');
    assert.equal(pairs[1].participant.name, 'B');
    assert.equal(pairs[1].match.key, 'k2');
});

test('buildPrintPairs for a single match skips participants not registered', () => {
    const pairs = buildPrintPairs(participants, matches, 'k1');
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].participant.name, 'A');
});

test('buildPrintPairs with no matchKey groups by participant, then match order', () => {
    const pairs = buildPrintPairs(participants, matches, null);
    assert.equal(pairs.length, 3);
    assert.deepEqual(
        pairs.map((pair) => [pair.participant.name, pair.match.key]),
        [['A', 'k1'], ['A', 'k2'], ['B', 'k2']],
    );
});

test('buildPrintPairs returns an empty array when the match key does not exist', () => {
    assert.deepEqual(buildPrintPairs(participants, matches, 'missing'), []);
});

test('totalPrice sums the prices of the registered matches only', () => {
    const priced = [
        { key: 'k1', price: '10' },
        { key: 'k2', price: '12.5' },
        { key: 'k3', price: '5' },
    ];
    assert.equal(totalPrice(['k1', 'k2'], priced), 22.5);
    assert.equal(totalPrice([], priced), 0);
    assert.equal(totalPrice(['k3'], priced), 5);
});

test('totalPrice treats missing or non-numeric prices as 0', () => {
    const priced = [{ key: 'k1' }, { key: 'k2', price: '' }, { key: 'k3', price: 'abc' }];
    assert.equal(totalPrice(['k1', 'k2', 'k3'], priced), 0);
});
