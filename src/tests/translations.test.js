import { test } from 'node:test';
import assert from 'node:assert/strict';

import { translate, TRANSLATIONS } from '../core/translations.js';

test('translate returns the key itself when missing', () => {
    assert.equal(translate({}, 'unknown.key'), 'unknown.key');
});

test('translate substitutes named placeholders', () => {
    assert.equal(
        translate(TRANSLATIONS.de, 'msg.csvImported', { added: 5, updated: 2 }),
        '5 Teilnehmer hinzugefügt, 2 aktualisiert.'
    );
});

test('translate uses the requested dictionary', () => {
    assert.equal(translate(TRANSLATIONS.fr, 'btn.printAll'), 'Tous');
});
