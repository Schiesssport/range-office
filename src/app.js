// =============================================================================
// OpenRangeOffice — DOM/storage layer.
// Pure logic lives in src/core/*.js (no DOM, unit-tested under src/tests).
// Each core module is imported as a namespace so call sites read like
// `Escape.escapeHtml(...)`, mirroring the class-as-namespace style used below.
// =============================================================================

import * as Escape           from './core/escape.js';
import * as I18n             from './core/translations.js';
import * as Ages             from './core/categories.js';
import * as BarcodeCodec     from './core/barcodes.js';
import * as Csv              from './core/csv.js';
import * as Licenses         from './core/licenses.js';
import * as UpdateTime       from './core/updates.js';
import * as Ids              from './core/ids.js';
import * as MatchOrder       from './core/matches.js';
import * as ScorecardLayout  from './core/scorecards.js';

const $  = (id) => document.getElementById(id);
const $$ = (selector, ctx = document) => ctx.querySelectorAll(selector);

const newKey = () => Ids.uuid7(Date.now(), crypto.getRandomValues(new Uint8Array(10)));

const triggerDownload = (filename, blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
};

// CSVs from Swiss tooling are often Windows-1252, not UTF-8. Try strict UTF-8
// first; on a decode error, fall back to Windows-1252 (a Latin1 superset).
const readTextFile = async (file) => {
    const buffer = await file.arrayBuffer();
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (_) {
        return new TextDecoder('windows-1252').decode(buffer);
    }
};

// -----------------------------------------------------------------------------
// Local storage migration (runs on every boot)
//
// Each registry maps OLD major version → migrator that takes the current
// wrapper ({version, data} or {version, items}) and returns the next major's
// wrapper. Fresh installs (wrapper absent) skip the migration entirely.
// -----------------------------------------------------------------------------

class Migrations {
    static settings     = {};
    static participants = {};

    static run() {
        Migrations.runOne('settings',     Backup.SETTINGS_VERSION,     Migrations.settings);
        Migrations.runOne('participants', Backup.PARTICIPANTS_VERSION, Migrations.participants);
    }

    static runOne(storageKey, currentVersion, registry) {
        const raw = localStorage.getItem(storageKey);
        if (raw === null) return;
        let wrapper;
        try { wrapper = JSON.parse(raw); } catch (_) { return; }
        let from = Backup.majorOf(wrapper.version);
        const to = Backup.majorOf(currentVersion);
        while (from < to) {
            const step = registry[from];
            if (step) wrapper = step(wrapper);
            from++;
        }
        wrapper.version = currentVersion;
        localStorage.setItem(storageKey, JSON.stringify(wrapper));
    }
}

// -----------------------------------------------------------------------------
// User settings — local-only preferences, NOT part of an event export
// -----------------------------------------------------------------------------

class UserSettings {
    static read() {
        try { return JSON.parse(localStorage.getItem('userSettings') || '{}'); }
        catch (_) { return {}; }
    }

    static patch(values) {
        const merged = { ...UserSettings.read(), ...values };
        localStorage.setItem('userSettings', JSON.stringify(merged));
    }
}

// -----------------------------------------------------------------------------
// Translations
// -----------------------------------------------------------------------------

class Translations {
    static getLanguage() {
        const stored = UserSettings.read().language;
        return I18n.TRANSLATIONS[stored] ? stored : I18n.DEFAULT_LANGUAGE;
    }

    static t(key, params = {}) {
        const dict = I18n.TRANSLATIONS[Translations.getLanguage()] || I18n.TRANSLATIONS[I18n.DEFAULT_LANGUAGE];
        return I18n.translate(dict, key, params);
    }

    static apply() {
        document.documentElement.lang = Translations.getLanguage();
        $$('[data-i18n]').forEach(el => { el.textContent = Translations.t(el.dataset.i18n); });
        $$('[data-i18n-placeholder]').forEach(el => { el.placeholder = Translations.t(el.dataset.i18nPlaceholder); });
        $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', Translations.t(el.dataset.i18nAria)); });
    }

    static set(lang) {
        if (!I18n.TRANSLATIONS[lang]) return;
        UserSettings.patch({ language: lang });
        Translations.apply();
        Participants.refreshDynamicTexts();
        LicenseDb.refreshStatus();
        Matches.renderSettings();
        Scorecards.renderSettings();
        Toolbar.renderPrintGroup();
    }
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

class Settings {
    static BINDINGS = [
        { storageKey: 'eventName',         elementId: 'event-name-input',         type: 'text',     defaultValue: String(new Date().getFullYear()) },
        { storageKey: 'participantPrefix', elementId: 'participant-prefix-input', type: 'text',     defaultValue: '10' },
        { storageKey: 'licenseEnabled',    elementId: 'license-enabled-input',    type: 'checkbox', defaultValue: true },
        { storageKey: 'customColumn1Name', elementId: 'custom-column-1-input',    type: 'text',     defaultValue: ''   },
        { storageKey: 'customColumn2Name', elementId: 'custom-column-2-input',    type: 'text',     defaultValue: ''   },
    ];

    static BY_KEY = Object.fromEntries(Settings.BINDINGS.map(b => [b.storageKey, b]));

    // Read the {version, data} wrapper. Returns the data object, or {} if absent
    // or version-incompatible.
    static readData() {
        try {
            const raw = localStorage.getItem('settings');
            if (!raw) return {};
            const wrapper = JSON.parse(raw);
            if (Backup.majorOf(wrapper.version) !== Backup.majorOf(Backup.SETTINGS_VERSION)) return {};
            return wrapper.data || {};
        } catch (_) { return {}; }
    }

    static writeData(data) {
        localStorage.setItem('settings', JSON.stringify({
            version: Backup.SETTINGS_VERSION,
            data,
        }));
    }

    static load() {
        const data = Settings.readData();
        Settings.BINDINGS.forEach(({ storageKey, elementId, type, defaultValue }) => {
            const el = $(elementId);
            const value = data[storageKey];
            if (type === 'checkbox') {
                el.checked = value === undefined ? !!defaultValue : !!value;
            } else {
                el.value = value ?? defaultValue;
            }
        });
    }

    static save() {
        const data = Settings.readData();
        Settings.BINDINGS.forEach(({ storageKey, elementId, type }) => {
            const el = $(elementId);
            data[storageKey] = type === 'checkbox' ? el.checked : el.value;
        });
        Settings.writeData(data);
        Participants.applyColumnVisibility();
    }

    static get(storageKey) {
        const binding = Settings.BY_KEY[storageKey];
        const el = $(binding.elementId);
        if (binding.type === 'checkbox') return el.checked;
        return el.value || binding.defaultValue;
    }

    // For non-form settings (eventLogo)
    static getRaw(key) {
        return Settings.readData()[key];
    }

    static setRaw(key, value) {
        const data = Settings.readData();
        data[key] = value;
        Settings.writeData(data);
    }
}

// -----------------------------------------------------------------------------
// Event logo
// -----------------------------------------------------------------------------

class Logo {
    static loadFrom(input) {
        if (!input.files[0]) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            Settings.setRaw('eventLogo', e.target.result);
            Logo.updatePreview();
        };
        reader.readAsDataURL(input.files[0]);
    }

    static clear() {
        Settings.setRaw('eventLogo', '');
        Logo.updatePreview();
    }

    static updatePreview() {
        const dataUrl = Settings.getRaw('eventLogo') || '';
        const img = $('logo-preview');
        const btn = $('clear-logo-button');
        img.src = dataUrl;
        img.style.display = dataUrl ? 'block' : 'none';
        btn.style.display = dataUrl ? 'inline-block' : 'none';
    }
}

// -----------------------------------------------------------------------------
// Tabs
// -----------------------------------------------------------------------------

class Tabs {
    static VIEWS = ['data', 'print', 'settings'];

    static switch(tab) {
        Tabs.VIEWS.forEach(name => $(name + '-view').classList.toggle('hidden', name !== tab));
        $$('.tab-btn').forEach(b => b.classList.toggle('active', b.id === 'tab-' + tab));
        if (tab === 'print') Scorecards.renderPreview();
    }
}

// -----------------------------------------------------------------------------
// Category badges
// -----------------------------------------------------------------------------

class Categories {
    static currentYear() { return new Date().getFullYear(); }

    static get(yob) { return Ages.getCategory(yob, Categories.currentYear()); }

    static updateBadge(rowEl) {
        const yobInput = rowEl.querySelector('.field-yob');
        const badge    = rowEl.querySelector('.cat-badge');
        if (!yobInput || !badge) return;
        const cat = Categories.get(yobInput.value);
        badge.textContent = cat ? cat.code : '';
        badge.title = cat
            ? Translations.t('category.tooltip', { name: Translations.t('category.' + cat.code), age: cat.age })
            : '';
    }

    static updateAll() {
        $$('#participants-tbody tr').forEach(Categories.updateBadge);
    }

    static expandYob(inputEl) {
        const expanded = Ages.expandTwoDigitYear(inputEl.value.trim(), Categories.currentYear());
        if (expanded === null) return;
        inputEl.value = expanded;
        Categories.updateBadge(inputEl.closest('tr'));
        Participants.save();
    }
}

// -----------------------------------------------------------------------------
// Barcodes
// -----------------------------------------------------------------------------

class Barcodes {
    static OPTIONS = { width: 2, height: 40, displayValue: true, fontSize: 14, margin: 0 };
    static cache = new Map();

    static render(value) {
        const cached = Barcodes.cache.get(value);
        if (cached) return cached;
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, value, Barcodes.OPTIONS);
        const dataUrl = canvas.toDataURL();
        Barcodes.cache.set(value, dataUrl);
        return dataUrl;
    }

    static matchCode(match) {
        return BarcodeCodec.buildMatchCode({
            codePrefix: match.codePrefix,
            matchCode:  match.matchCode,
            targetCode: match.targetCode,
        });
    }

    static participantCode(license) {
        return BarcodeCodec.buildParticipantCode({
            prefix:  Settings.get('participantPrefix'),
            license,
            enabled: Settings.get('licenseEnabled'),
        });
    }
}

// -----------------------------------------------------------------------------
// Matches ("Stiche") — the competition rounds a participant can register for.
// Stored as an ordered list in settings; the order drives print buttons and
// print order. At least one match always exists.
// -----------------------------------------------------------------------------

class Matches {
    static MAX = 5;

    static all()      { return Settings.getRaw('matches') || []; }
    static save(list) { Settings.setRaw('matches', list); }
    static byKey(key) { return Matches.all().find(match => match.key === key) || null; }

    static seedIfEmpty() {
        if (Matches.all().length) return;
        Matches.save([Matches.createDefault('H', Translations.t('match.defaultTitle'), '001')]);
    }

    static createDefault(label, title, matchCode) {
        return {
            key:          newKey(),
            label,
            title,
            codePrefix:   '20',
            matchCode,
            targetCode:   '010',
            price:        '0',
            scorecardKey: Scorecards.all()[0]?.key ?? null,
        };
    }

    static nextOrdinal() {
        const codes = Matches.all().map(match => parseInt(match.matchCode, 10)).filter(Number.isFinite);
        return (codes.length ? Math.max(...codes) : 0) + 1;
    }

    static add() {
        const list = Matches.all();
        if (list.length >= Matches.MAX) return;
        const ordinal = Matches.nextOrdinal();
        list.push(Matches.createDefault(String(ordinal), '', String(ordinal).padStart(3, '0')));
        Matches.save(list);
        Matches.renderSettings();
        Matches.afterStructureChange();
    }

    static remove(key) {
        const list = Matches.all();
        if (list.length <= 1) return;
        Matches.save(list.filter(match => match.key !== key));
        Matches.renderSettings();
        Matches.afterStructureChange();
    }

    static move(key, delta) {
        const list = Matches.all();
        const index = list.findIndex(match => match.key === key);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= list.length) return;
        [list[index], list[target]] = [list[target], list[index]];
        Matches.save(list);
        Matches.renderSettings();
        Matches.afterStructureChange();
    }

    static update(key, field, value) {
        const list = Matches.all();
        const match = list.find(item => item.key === key);
        if (!match) return;
        match[field] = field === 'label' ? MatchOrder.normalizeLabel(value) : value;
        Matches.save(list);
        Participants.refreshMatchToggles();
        Toolbar.renderPrintGroup();
    }

    static afterStructureChange() {
        Participants.refreshMatchToggles();
        Toolbar.renderPrintGroup();
    }

    static renderSettings() {
        const body = $('matches-tbody');
        if (!body) return;
        const list = Matches.all();
        const scorecardOptions = (selectedKey) => Scorecards.all().map(scorecard =>
            `<option value="${Escape.escapeHtml(scorecard.key)}"${scorecard.key === selectedKey ? ' selected' : ''}>${Escape.escapeHtml(scorecard.name)}</option>`
        ).join('');
        const numberInput = (match, field, maxLength) =>
            `<input class="match-cell mono" maxlength="${maxLength}" value="${Escape.escapeHtml(match[field])}" oninput="Matches.update('${match.key}','${field}',this.value)">`;
        body.innerHTML = list.map((match, index) => `
            <tr>
                <td>${numberInput(match, 'label', 2)}</td>
                <td><input class="match-cell" value="${Escape.escapeHtml(match.title)}" oninput="Matches.update('${match.key}','title',this.value)"></td>
                <td>${numberInput(match, 'codePrefix', 2)}</td>
                <td>${numberInput(match, 'matchCode', 3)}</td>
                <td>${numberInput(match, 'targetCode', 3)}</td>
                <td><input type="number" step="any" min="0" class="match-cell mono" value="${Escape.escapeHtml(match.price ?? '')}" oninput="Matches.update('${match.key}','price',this.value)"></td>
                <td><select class="match-cell" onchange="Matches.update('${match.key}','scorecardKey',this.value)">${scorecardOptions(match.scorecardKey)}</select></td>
                <td class="match-order">
                    <button type="button" class="btn-neutral btn-icon" onclick="Matches.move('${match.key}',-1)"${index === 0 ? ' disabled' : ''} aria-label="${Escape.escapeHtml(Translations.t('btn.moveUp'))}">▲</button>
                    <button type="button" class="btn-neutral btn-icon" onclick="Matches.move('${match.key}',1)"${index === list.length - 1 ? ' disabled' : ''} aria-label="${Escape.escapeHtml(Translations.t('btn.moveDown'))}">▼</button>
                </td>
                <td><button type="button" class="btn-danger-ghost btn-icon" onclick="Matches.remove('${match.key}')"${list.length <= 1 ? ' disabled' : ''} aria-label="✕">✕</button></td>
            </tr>`).join('');
        const addButton = $('add-match-button');
        if (addButton) addButton.disabled = list.length >= Matches.MAX;
    }
}

// -----------------------------------------------------------------------------
// Scorecards ("Standblätter") — print templates. Fields (barcodes, name, title,
// event name, logo) are placed in millimetres over an optional PDF backdrop.
// Each match points to one scorecard; at least one scorecard always exists.
// -----------------------------------------------------------------------------

class Scorecards {
    static MAX_PDF_BYTES        = 1024 * 1024;
    static PRINT_DPI            = 300;
    static PREVIEW_WIDTH_PX     = 560;
    static PREVIEW_MAX_HEIGHT_PX = 460;

    static FIELDS = [
        { kind: 'participantBarcode', type: 'barcode' },
        { kind: 'matchBarcode',       type: 'barcode' },
        { kind: 'participantName',    type: 'text'    },
        { kind: 'participantYob',     type: 'text'    },
        { kind: 'matchTitle',         type: 'text'    },
        { kind: 'eventName',          type: 'text'    },
        { kind: 'eventLogo',          type: 'image'   },
        { kind: 'participantCustom1', type: 'text'    },
        { kind: 'participantCustom2', type: 'text'    },
        { kind: 'freeText1',          type: 'text', hasOwnText: true },
        { kind: 'freeText2',          type: 'text', hasOwnText: true },
    ];

    static activeKey        = null;
    static previewToken     = 0;
    static previewBackdrops = new Map();

    static all()      { return Settings.getRaw('scorecards') || []; }
    static save(list) { Settings.setRaw('scorecards', list); }
    static byKey(key) { return Scorecards.all().find(scorecard => scorecard.key === key) || null; }

    static getActive() {
        const all = Scorecards.all();
        return all.find(scorecard => scorecard.key === Scorecards.activeKey) || all[0] || null;
    }

    static seedIfEmpty() {
        if (Scorecards.all().length) return;
        Scorecards.save([Scorecards.createDefault()]);
    }

    static createDefault() {
        return {
            key:          newKey(),
            name:         Translations.t('scorecard.defaultName'),
            pdfDataUrl:   '',
            pageWidthMm:  70,
            pageHeightMm: 198,
            fields:       Scorecards.defaultFields(),
        };
    }

    // Reproduces the classic 70×198 mm score sheet: content bottom-half of the
    // sheet, mirrored into a second 35 mm column via the field pair (split,
    // tear-off paper). Adjust freely per scorecard once created.
    static defaultFields() {
        const pair = (enabled) => ({ enabled, horizontalOffsetMm: 35, verticalOffsetMm: 0 });
        return {
            participantBarcode: { enabled: true,  fromLeftMm: 3,  fromTopMm: 128, widthMm: 30, heightMm: 15, pair: pair(false) },
            matchBarcode:       { enabled: true,  fromLeftMm: 3,  fromTopMm: 142, widthMm: 30, heightMm: 15, pair: pair(false) },
            participantName:    { enabled: true,  fromLeftMm: 3,  fromTopMm: 158, widthMm: 30, heightMm: 10, fontPt: 8, pair: pair(true) },
            participantYob:     { enabled: true,  fromLeftMm: 22,  fromTopMm: 165, widthMm: 11, heightMm: 4,  fontPt: 8, pair: pair(true) },
            matchTitle:         { enabled: true,  fromLeftMm: 3,  fromTopMm: 169, widthMm: 30, heightMm: 4,  fontPt: 6, pair: pair(true) },
            eventName:          { enabled: true,  fromLeftMm: 3,  fromTopMm: 172, widthMm: 30, heightMm: 4,  fontPt: 6, pair: pair(true) },
            eventLogo:          { enabled: true,  fromLeftMm: 3,  fromTopMm: 178, widthMm: 30, heightMm: 14, pair: pair(true) },
            participantCustom1: { enabled: false, fromLeftMm: 3,  fromTopMm: 112, widthMm: 30, heightMm: 4,  fontPt: 8, pair: pair(true) },
            participantCustom2: { enabled: false, fromLeftMm: 3,  fromTopMm: 108, widthMm: 30, heightMm: 4,  fontPt: 8, pair: pair(true) },
            freeText1:          { enabled: true,  fromLeftMm: 38, fromTopMm: 150, widthMm: 30, heightMm: 5,  fontPt: 7, text: Translations.t('scorecard.copyText'), pair: pair(false) },
            freeText2:          { enabled: false, fromLeftMm: 3,  fromTopMm: 112, widthMm: 30, heightMm: 5,  fontPt: 9, text: '', pair: pair(false) },
        };
    }

    static fieldLabel(kind) {
        if (kind === 'participantCustom1') return Settings.get('customColumn1Name').trim() || Translations.t('settings.customColumn1');
        if (kind === 'participantCustom2') return Settings.get('customColumn2Name').trim() || Translations.t('settings.customColumn2');
        return Translations.t('scorecard.field.' + kind);
    }

    // Merges a stored field over the default shape so a partial or hand-edited
    // scorecard (missing a field kind or its pair) never crashes the editor.
    static fieldOf(scorecard, kind) {
        const base = Scorecards.defaultFields()[kind];
        const stored = scorecard.fields?.[kind];
        if (!stored) return base;
        return { ...base, ...stored, pair: { ...base.pair, ...(stored.pair || {}) } };
    }

    static mutate(key, change) {
        const list = Scorecards.all();
        const scorecard = list.find(item => item.key === key);
        if (!scorecard) return;
        change(scorecard);
        Scorecards.save(list);
    }

    static add() {
        const scorecard = Scorecards.createDefault();
        Scorecards.save([...Scorecards.all(), scorecard]);
        Scorecards.activeKey = scorecard.key;
        Scorecards.renderSettings();
        Matches.renderSettings();
    }

    static clone(key) {
        const source = Scorecards.byKey(key);
        if (!source) return;
        const copy = JSON.parse(JSON.stringify(source));
        copy.key = newKey();
        copy.name = `${source.name} ${Translations.t('scorecard.copySuffix')}`;
        Scorecards.save([...Scorecards.all(), copy]);
        Scorecards.activeKey = copy.key;
        Scorecards.renderSettings();
        Matches.renderSettings();
    }

    static remove(key) {
        const list = Scorecards.all();
        if (list.length <= 1) return;
        const remaining = list.filter(scorecard => scorecard.key !== key);
        Scorecards.save(remaining);
        Scorecards.relinkMatches(key, remaining[0].key);
        if (Scorecards.activeKey === key) Scorecards.activeKey = remaining[0].key;
        Scorecards.invalidateBackdrop(key);
        Scorecards.renderSettings();
        Matches.renderSettings();
    }

    static relinkMatches(removedKey, fallbackKey) {
        const matches = Matches.all();
        let changed = false;
        matches.forEach(match => {
            if (match.scorecardKey === removedKey) { match.scorecardKey = fallbackKey; changed = true; }
        });
        if (changed) Matches.save(matches);
    }

    static setActive(key) {
        Scorecards.activeKey = key;
        Scorecards.renderSettings();
    }

    static rename(key, name) {
        Scorecards.mutate(key, scorecard => { scorecard.name = name; });
        Matches.renderSettings();
        Scorecards.refreshSettingsTitle();
    }

    static NON_NEGATIVE_FIELD_PROPS = new Set(['widthMm', 'heightMm', 'fontPt']);

    static setPage(key, dimension, value) {
        Scorecards.mutate(key, scorecard => { scorecard[dimension] = Math.max(1, Number(value) || 0); });
        Scorecards.renderPreview();
    }

    // Scorecards saved before a field kind existed have no entry for it, so every
    // write goes through the merged default shape first.
    static writableField(scorecard, kind) {
        if (!scorecard.fields) scorecard.fields = {};
        scorecard.fields[kind] = Scorecards.fieldOf(scorecard, kind);
        return scorecard.fields[kind];
    }

    static setFieldEnabled(key, kind, enabled) {
        Scorecards.mutate(key, scorecard => { Scorecards.writableField(scorecard, kind).enabled = enabled; });
        Scorecards.renderPreview();
    }

    static setFieldNumber(key, kind, property, value) {
        const number = Number(value) || 0;
        const clamped = Scorecards.NON_NEGATIVE_FIELD_PROPS.has(property) ? Math.max(0, number) : number;
        Scorecards.mutate(key, scorecard => { Scorecards.writableField(scorecard, kind)[property] = clamped; });
        Scorecards.renderPreview();
    }

    static setFieldText(key, kind, text) {
        Scorecards.mutate(key, scorecard => { Scorecards.writableField(scorecard, kind).text = text; });
        Scorecards.renderPreview();
    }

    static setPairEnabled(key, kind, enabled) {
        Scorecards.mutate(key, scorecard => { Scorecards.writableField(scorecard, kind).pair.enabled = enabled; });
        Scorecards.renderPreview();
    }

    static setPairOffset(key, kind, property, value) {
        Scorecards.mutate(key, scorecard => { Scorecards.writableField(scorecard, kind).pair[property] = Number(value) || 0; });
        Scorecards.renderPreview();
    }

    static async uploadPdf(key, input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (file.size > Scorecards.MAX_PDF_BYTES) { alert(Translations.t('msg.pdfTooLarge')); return; }
        const dataUrl = await Scorecards.fileToDataUrl(file);
        const pageSize = await Scorecards.readPageSize(dataUrl);
        try {
            Scorecards.mutate(key, scorecard => {
                scorecard.pdfDataUrl = dataUrl;
                if (pageSize) { scorecard.pageWidthMm = pageSize.widthMm; scorecard.pageHeightMm = pageSize.heightMm; }
            });
        } catch (_) {
            alert(Translations.t('msg.storageFull'));
            return;
        }
        Scorecards.invalidateBackdrop(key);
        Scorecards.renderSettings();
    }

    static clearPdf(key) {
        Scorecards.mutate(key, scorecard => { scorecard.pdfDataUrl = ''; });
        Scorecards.invalidateBackdrop(key);
        Scorecards.renderSettings();
    }

    static fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    static dataUrlToBytes(dataUrl) {
        const binary = atob(dataUrl.split(',')[1] || '');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    static async loadFirstPage(dataUrl) {
        if (typeof pdfjsLib === 'undefined') return null;
        const document = await pdfjsLib.getDocument({ data: Scorecards.dataUrlToBytes(dataUrl) }).promise;
        return document.getPage(1);
    }

    static async readPageSize(dataUrl) {
        try {
            const page = await Scorecards.loadFirstPage(dataUrl);
            if (!page) return null;
            const viewport = page.getViewport({ scale: 1 });
            const pointToMm = 25.4 / 72;
            return { widthMm: Math.round(viewport.width * pointToMm), heightMm: Math.round(viewport.height * pointToMm) };
        } catch (_) {
            return null;
        }
    }

    static async rasterize(dataUrl, targetWidthPx) {
        try {
            const page = await Scorecards.loadFirstPage(dataUrl);
            if (!page) return null;
            const unscaled = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: targetWidthPx / unscaled.width });
            const canvas = document.createElement('canvas');
            canvas.width  = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return canvas.toDataURL('image/png');
        } catch (_) {
            return null;
        }
    }

    // One scorecard lookup for a whole print run, so we parse the (PDF-heavy)
    // settings blob once instead of per pair.
    static resolver() {
        const all = Scorecards.all();
        const byKey = new Map(all.map(scorecard => [scorecard.key, scorecard]));
        const fallback = all[0] || null;
        return (match) => byKey.get(match?.scorecardKey) || fallback;
    }

    static async rasterizeBackdrops(pairs, resolveScorecard) {
        const scorecards = new Map();
        pairs.forEach(({ match }) => {
            const scorecard = resolveScorecard(match);
            if (scorecard) scorecards.set(scorecard.key, scorecard);
        });
        const backdrops = new Map();
        await Promise.all([...scorecards.values()].map(async scorecard => {
            const widthPx = Math.round(scorecard.pageWidthMm / 25.4 * Scorecards.PRINT_DPI);
            backdrops.set(scorecard.key, scorecard.pdfDataUrl ? await Scorecards.rasterize(scorecard.pdfDataUrl, widthPx) : null);
        }));
        return backdrops;
    }

    static invalidateBackdrop(key) { Scorecards.previewBackdrops.delete(key); }

    static async previewBackdrop(scorecard) {
        if (!scorecard.pdfDataUrl) return null;
        if (!Scorecards.previewBackdrops.has(scorecard.key)) {
            Scorecards.previewBackdrops.set(scorecard.key, await Scorecards.rasterize(scorecard.pdfDataUrl, Scorecards.PREVIEW_WIDTH_PX));
        }
        return Scorecards.previewBackdrops.get(scorecard.key);
    }

    static buildSheet(scorecard, participant, match, backdropDataUrl) {
        const sheet = document.createElement('div');
        sheet.className = 'scorecard-sheet';
        sheet.style.width  = `${scorecard.pageWidthMm}mm`;
        sheet.style.height = `${scorecard.pageHeightMm}mm`;
        if (backdropDataUrl) {
            const backdrop = document.createElement('img');
            backdrop.className = 'scorecard-backdrop';
            backdrop.src = backdropDataUrl;
            sheet.appendChild(backdrop);
        }
        Scorecards.FIELDS.forEach(({ kind, type }) => {
            const field = Scorecards.fieldOf(scorecard, kind);
            if (!field.enabled) return;
            const value = Scorecards.fieldValue(kind, participant, match, field);
            if (!value) return;
            ScorecardLayout.fieldPlacements(field).forEach(placement => {
                sheet.appendChild(Scorecards.buildFieldElement(type, field, value, placement));
            });
        });
        return sheet;
    }

    static fieldValue(kind, participant, match, field) {
        switch (kind) {
            case 'participantBarcode': {
                const code = Barcodes.participantCode((participant.license || '').trim());
                return code ? Barcodes.render(code) : null;
            }
            case 'matchBarcode': {
                const code = Barcodes.matchCode(match);
                return code ? Barcodes.render(code) : null;
            }
            case 'participantName': return `${participant.lastName || ''} ${participant.firstName || ''}`.trim() || null;
            case 'participantYob': {
                if (!participant.yearOfBirth) return null;
                const category = Categories.get(participant.yearOfBirth);
                return category ? `${participant.yearOfBirth} ${category.code}` : String(participant.yearOfBirth);
            }
            case 'matchTitle':      return match.title || match.label || null;
            case 'eventName':       return Settings.get('eventName') || null;
            case 'eventLogo':       return Settings.getRaw('eventLogo') || null;
            case 'participantCustom1': return (participant.custom1 || '').trim() || null;
            case 'participantCustom2': return (participant.custom2 || '').trim() || null;
            case 'freeText1':
            case 'freeText2':       return (field?.text || '').trim() || null;
            default:                return null;
        }
    }

    static buildFieldElement(type, field, value, placement) {
        const box = document.createElement('div');
        box.className = 'scorecard-field';
        box.style.left   = `${placement.fromLeftMm}mm`;
        box.style.top    = `${placement.fromTopMm}mm`;
        box.style.width  = `${placement.widthMm}mm`;
        box.style.height = `${placement.heightMm}mm`;
        if (type === 'text') {
            box.classList.add('scorecard-field-text');
            box.style.fontSize = `${field.fontPt || 10}pt`;
            box.textContent = value;
        } else {
            const image = document.createElement('img');
            image.className = 'scorecard-field-img';
            image.src = value;
            box.appendChild(image);
        }
        return box;
    }

    static previewParticipant() {
        const row = document.querySelector('#participants-tbody tr:not(.empty-row)');
        if (row) return Participants.readRow(row);
        return {
            license:     '123456',
            lastName:    Translations.t('preview.sampleLastName'),
            firstName:   Translations.t('preview.sampleFirstName'),
            yearOfBirth: '1990',
        };
    }

    static previewMatch(scorecard) {
        const matches = Matches.all();
        return matches.find(match => match.scorecardKey === scorecard.key) || matches[0] || null;
    }

    // Same print path as a real score sheet, fed with the preview sample data —
    // the browser dialog then offers full-size print or "save as PDF".
    static printPreview() {
        const scorecard = Scorecards.getActive();
        if (!scorecard) return;
        const match = { ...(Scorecards.previewMatch(scorecard) || {}), scorecardKey: scorecard.key };
        Printing.run([{ participant: Scorecards.previewParticipant(), match }]);
    }

    static async renderPreview() {
        const wrap = $('scorecard-preview');
        if (!wrap) return;
        const scorecard = Scorecards.getActive();
        if (!scorecard) { wrap.innerHTML = ''; return; }
        const token = ++Scorecards.previewToken;
        const backdrop = await Scorecards.previewBackdrop(scorecard);
        if (token !== Scorecards.previewToken) return;
        const sheet = Scorecards.buildSheet(scorecard, Scorecards.previewParticipant(), Scorecards.previewMatch(scorecard) || {}, backdrop);
        const scaler = document.createElement('div');
        scaler.className = 'scorecard-preview-scaler';
        scaler.appendChild(sheet);
        wrap.innerHTML = '';
        wrap.appendChild(scaler);
        const pixelPerMm = 96 / 25.4;
        const pageWidthPx = scorecard.pageWidthMm * pixelPerMm;
        const pageHeightPx = scorecard.pageHeightMm * pixelPerMm;
        const widthScale  = pageWidthPx  ? (wrap.clientWidth || 480) / pageWidthPx : 1;
        const heightScale = pageHeightPx ? Scorecards.PREVIEW_MAX_HEIGHT_PX / pageHeightPx : 1;
        const scale = Math.min(1, widthScale, heightScale);
        scaler.style.transform = `scale(${scale})`;
        wrap.style.height = `${pageHeightPx * scale}px`;
    }

    static renderSettings() {
        const listBody = $('scorecards-tbody');
        const editor   = $('scorecard-editor');
        if (!listBody || !editor) return;
        const all = Scorecards.all();
        const active = Scorecards.getActive();
        Scorecards.activeKey = active?.key ?? null;
        listBody.innerHTML = all.map(scorecard => Scorecards.listRowHtml(scorecard, active, all.length)).join('');
        editor.innerHTML = active ? Scorecards.editorHtml(active) : '';
        Scorecards.refreshSettingsTitle();
        Scorecards.renderPreview();
    }

    static refreshSettingsTitle() {
        const title = $('scorecard-settings-title');
        if (!title) return;
        const active = Scorecards.getActive();
        title.textContent = active ? Translations.t('scorecard.settingsTitle', { name: active.name }) : '';
    }

    static listRowHtml(scorecard, active, count) {
        const isActive = active && scorecard.key === active.key;
        return `
            <tr class="scorecard-row${isActive ? ' is-active' : ''}">
                <td><input type="radio" name="active-scorecard" ${isActive ? 'checked' : ''} onchange="Scorecards.setActive('${scorecard.key}')" aria-label="${Escape.escapeHtml(Translations.t('scorecard.edit'))}"></td>
                <td><input class="scorecard-name" value="${Escape.escapeHtml(scorecard.name)}" oninput="Scorecards.rename('${scorecard.key}',this.value)"></td>
                <td><button type="button" class="btn-neutral btn-icon" onclick="Scorecards.clone('${scorecard.key}')" title="${Escape.escapeHtml(Translations.t('scorecard.clone'))}" aria-label="${Escape.escapeHtml(Translations.t('scorecard.clone'))}">⧉</button></td>
                <td><button type="button" class="btn-danger-ghost btn-icon" onclick="Scorecards.remove('${scorecard.key}')"${count <= 1 ? ' disabled' : ''} aria-label="✕">✕</button></td>
            </tr>`;
    }

    static editorHtml(scorecard) {
        const t = (key) => Escape.escapeHtml(Translations.t(key));
        const numberCell = (kind, property, value, min) =>
            `<input type="number" step="any"${min === undefined ? '' : ` min="${min}"`} class="scorecard-num" value="${value}" oninput="Scorecards.setFieldNumber('${scorecard.key}','${kind}','${property}',this.value)">`;
        const fieldRows = Scorecards.FIELDS.map(({ kind, type, hasOwnText }) => {
            const field = Scorecards.fieldOf(scorecard, kind);
            const fontCell = type === 'text'
                ? `<input type="number" step="any" min="0" class="scorecard-num" value="${field.fontPt || 10}" oninput="Scorecards.setFieldNumber('${scorecard.key}','${kind}','fontPt',this.value)">`
                : '';
            const label = Escape.escapeHtml(Scorecards.fieldLabel(kind));
            const nameCell = hasOwnText
                ? `<input type="text" class="scorecard-text" value="${Escape.escapeHtml(field.text || '')}" placeholder="${label}" aria-label="${label}" oninput="Scorecards.setFieldText('${scorecard.key}','${kind}',this.value)">`
                : label;
            return `
                <tr>
                    <td>${nameCell}</td>
                    <td><input type="checkbox" ${field.enabled ? 'checked' : ''} onchange="Scorecards.setFieldEnabled('${scorecard.key}','${kind}',this.checked)"></td>
                    <td>${numberCell(kind, 'fromLeftMm', field.fromLeftMm)}</td>
                    <td>${numberCell(kind, 'fromTopMm', field.fromTopMm)}</td>
                    <td>${numberCell(kind, 'widthMm', field.widthMm, 0)}</td>
                    <td>${numberCell(kind, 'heightMm', field.heightMm, 0)}</td>
                    <td>${fontCell}</td>
                    <td><input type="checkbox" ${field.pair.enabled ? 'checked' : ''} onchange="Scorecards.setPairEnabled('${scorecard.key}','${kind}',this.checked)"></td>
                    <td><input type="number" step="any" class="scorecard-num" value="${field.pair.horizontalOffsetMm}" oninput="Scorecards.setPairOffset('${scorecard.key}','${kind}','horizontalOffsetMm',this.value)"></td>
                    <td><input type="number" step="any" class="scorecard-num" value="${field.pair.verticalOffsetMm}" oninput="Scorecards.setPairOffset('${scorecard.key}','${kind}','verticalOffsetMm',this.value)"></td>
                </tr>`;
        }).join('');
        const backdropControl = scorecard.pdfDataUrl
            ? `<span class="license-db-status">${t('scorecard.backdropLoaded')}</span>
               <button type="button" class="btn-danger-ghost" onclick="Scorecards.clearPdf('${scorecard.key}')">${t('scorecard.removeBackdrop')}</button>`
            : `<input type="file" class="scorecard-pdf-input" accept="application/pdf" onchange="Scorecards.uploadPdf('${scorecard.key}',this)">
               <span class="license-db-status">${t('scorecard.backdropNone')}</span>`;
        return `
            <div class="scorecard-editor-head">
                <div class="scorecard-backdrop-control">
                    <label>${t('scorecard.backdrop')}</label>
                    <div class="license-db-row scorecard-backdrop-row">${backdropControl}</div>
                    <p class="settings-section-description">${t('scorecard.backdropHint')}</p>
                </div>
                <div class="scorecard-page-control">
                    <label>${t('scorecard.pageSize')}</label>
                    <div class="scorecard-page-inputs">
                        <input type="number" step="any" class="scorecard-num" value="${scorecard.pageWidthMm}" oninput="Scorecards.setPage('${scorecard.key}','pageWidthMm',this.value)">
                        <span>×</span>
                        <input type="number" step="any" class="scorecard-num" value="${scorecard.pageHeightMm}" oninput="Scorecards.setPage('${scorecard.key}','pageHeightMm',this.value)">
                        <span>mm</span>
                    </div>
                </div>
            </div>
            <div class="table-scroll-x">
            <table class="scorecard-fields-table">
                <thead>
                    <tr>
                        <th>${t('scorecard.col.field')}</th>
                        <th>${t('scorecard.col.show')}</th>
                        <th>${t('scorecard.col.fromLeft')}</th>
                        <th>${t('scorecard.col.fromTop')}</th>
                        <th>${t('scorecard.col.width')}</th>
                        <th>${t('scorecard.col.height')}</th>
                        <th>${t('scorecard.col.font')}</th>
                        <th>${t('scorecard.col.pair')}</th>
                        <th>${t('scorecard.col.pairLeft')}</th>
                        <th>${t('scorecard.col.pairTop')}</th>
                    </tr>
                </thead>
                <tbody>${fieldRows}</tbody>
            </table>
            </div>`;
    }
}

// -----------------------------------------------------------------------------
// Participants — fields + row management + column visibility
// -----------------------------------------------------------------------------

class Participants {
    static FIELDS = [
        {
            key: 'license',
            cls: 'field-license',
            type: 'text',
            col: 'license',
            placeholderKey: 'placeholder.license',
            headerKey: 'col.licenseNumber',
            isVisible: () => Settings.get('licenseEnabled'),
        },
        {
            key: 'lastName',
            cls: 'field-lastname',
            type: 'text',
            placeholderKey: 'placeholder.lastName',
            headerKey: 'col.lastName',
        },
        {
            key: 'firstName',
            cls: 'field-firstname',
            type: 'text',
            placeholderKey: 'placeholder.firstName',
            headerKey: 'col.firstName',
        },
        {
            key: 'yearOfBirth',
            cls: 'field-yob',
            type: 'number',
            placeholder: '1990',
            headerKey: 'col.yearOfBirth',
        },
        {
            key: 'custom1',
            cls: 'field-custom1',
            type: 'text',
            col: 'custom1',
            isVisible: () => Settings.get('customColumn1Name').trim() !== '',
            getHeader: () => Settings.get('customColumn1Name').trim(),
        },
        {
            key: 'custom2',
            cls: 'field-custom2',
            type: 'text',
            col: 'custom2',
            isVisible: () => Settings.get('customColumn2Name').trim() !== '',
            getHeader: () => Settings.get('customColumn2Name').trim(),
        },
    ];

    static PRINT_ICON = '🖶';

    static fieldHeader(field) {
        return field.getHeader ? field.getHeader() : Translations.t(field.headerKey);
    }

    static readRow(rowEl) {
        const data = Object.fromEntries(
            Participants.FIELDS.map(f => [f.key, rowEl.querySelector('.' + f.cls)?.value ?? ''])
        );
        data.registeredMatches = Participants.readRegisteredMatches(rowEl);
        data.paid = Participants.isPaid(rowEl);
        return data;
    }

    static readRegisteredMatches(rowEl) {
        return [...rowEl.querySelectorAll('.match-toggle.is-on')].map(button => button.dataset.matchKey);
    }

    static defaultRegistration() {
        const first = Matches.all()[0];
        return first ? [first.key] : [];
    }

    static matchTogglesHtml(registeredMatches) {
        const active = new Set(registeredMatches || []);
        return Matches.all().map(match => {
            const isOn  = active.has(match.key);
            const title = Escape.escapeHtml(match.title || match.label);
            return `<button type="button" class="match-toggle${isOn ? ' is-on' : ''}" data-match-key="${Escape.escapeHtml(match.key)}" aria-pressed="${isOn}" title="${title}" onclick="Participants.toggleMatch(this)" tabindex="-1">${Escape.escapeHtml(match.label)}</button>`;
        }).join('');
    }

    static toggleMatch(button) {
        const isOn = button.classList.toggle('is-on');
        button.setAttribute('aria-pressed', isOn);
        Participants.updatePayment(button.closest('tr'));
        Participants.handleChanged();
    }

    static refreshMatchToggles() {
        $$('#participants-tbody tr').forEach(rowEl => {
            const group = rowEl.querySelector('.match-toggle-group');
            if (group) group.innerHTML = Participants.matchTogglesHtml(Participants.readRegisteredMatches(rowEl));
            Participants.applyLock(rowEl, rowEl.classList.contains('row-paid'));
            Participants.updatePayment(rowEl);
        });
    }

    // Payment gate: confirming payment locks the row (fields + match toggles) and
    // enables printing; reverting (behind a confirm) unlocks it and disables print.
    static isPaid(rowEl) {
        return rowEl.classList.contains('row-paid');
    }

    static togglePaid(button) {
        const rowEl = button.closest('tr');
        if (!rowEl || rowEl.classList.contains('empty-row')) return;
        const paid = Participants.isPaid(rowEl);
        if (paid && !confirm(Translations.t('confirm.revertPayment'))) return;
        Participants.setPaid(rowEl, !paid);
        Participants.handleChanged();
    }

    static setPaid(rowEl, paid) {
        rowEl.classList.toggle('row-paid', paid);
        Participants.applyLock(rowEl, paid);
        Participants.updatePayment(rowEl);
    }

    static applyLock(rowEl, locked) {
        Participants.FIELDS.forEach(f => {
            const el = rowEl.querySelector('.' + f.cls);
            if (el) el.readOnly = locked;
        });
        rowEl.querySelectorAll('.match-toggle').forEach(button => { button.disabled = locked; });
        const lens = rowEl.querySelector('.license-search-btn');
        if (lens) { if (locked) lens.disabled = true; else Participants.updateLensState(rowEl); }
        const printButton = rowEl.querySelector('[data-row-action="print"]');
        if (printButton) printButton.disabled = !locked;
    }

    static formatPrice(value) {
        return (Number(value) || 0).toFixed(2);
    }

    static updatePayment(rowEl) {
        const button = rowEl.querySelector('.payment-toggle');
        if (!button) return;
        const paid  = Participants.isPaid(rowEl);
        const total = MatchOrder.totalPrice(Participants.readRegisteredMatches(rowEl), Matches.all());
        button.textContent = (paid ? '✓ ' : '') + Participants.formatPrice(total);
        button.classList.toggle('is-paid', paid);
        button.setAttribute('aria-pressed', paid ? 'true' : 'false');
        button.title = Translations.t(paid ? 'payment.revertHint' : 'payment.confirmHint');
    }

    static visibleColumns() {
        return Participants.FIELDS.filter(f => !f.isVisible || f.isVisible());
    }

    static applyColumnVisibility() {
        Participants.FIELDS.filter(f => f.col).forEach(f => {
            const visible = !f.isVisible || f.isVisible();
            $$(`[data-col="${f.col}"]`).forEach(el => el.classList.toggle('hidden', !visible));
            const headerEl = document.querySelector(`th[data-col="${f.col}"]`);
            if (headerEl && f.getHeader) headerEl.textContent = f.getHeader();
        });
    }

    static ON_CHANGE = {
        yearOfBirth: 'Categories.expandYob(this)',
        license:     'Participants.lookupLicense(this)',
    };

    static buildRowHtml(data) {
        const searchLabel = Escape.escapeHtml(Translations.t('btn.searchLicense'));
        const cells = Participants.FIELDS.map(f => {
            const value       = Escape.escapeHtml(data[f.key] || '');
            const placeholder = Escape.escapeHtml(f.placeholderKey ? Translations.t(f.placeholderKey) : (f.placeholder || ''));
            const colAttr     = f.col ? ` data-col="${f.col}"` : '';
            const onChange    = Participants.ON_CHANGE[f.key];
            const changeAttr  = onChange ? ` onchange="${onChange}"` : '';
            const input       = `<input type="${f.type}" class="${f.cls}" value="${value}" placeholder="${placeholder}" oninput="Participants.onInput(this)"${changeAttr}>`;
            if (f.key === 'yearOfBirth') {
                return `<td${colAttr}><div class="yob-cell">${input}<span class="cat-badge"></span></div></td>`;
            }
            if (f.key === 'license') {
                const hasLicense = (data.license || '').trim() !== '';
                const lensEnabled = LicenseDb.recordCount > 0 && !hasLicense;
                const disabledAttr = lensEnabled ? '' : ' disabled';
                const lens = `<button type="button" class="license-search-btn" tabindex="-1" title="${searchLabel}" aria-label="${searchLabel}" onclick="LicenseDb.openSearch(this)"${disabledAttr}>🔍</button>`;
                return `<td${colAttr}><div class="license-cell">${lens}${input}</div></td>`;
            }
            return `<td${colAttr}>${input}</td>`;
        }).join('');

        const printLabel = Escape.escapeHtml(Translations.t('btn.printParticipant'));
        const toggles    = Participants.matchTogglesHtml(data.registeredMatches);
        return `
            <td><input type="checkbox" class="row-check" tabindex="-1" onchange="Toolbar.updateLabels()"></td>
            ${cells}
            <td class="registered-cell"><div class="match-toggle-group">${toggles}</div></td>
            <td class="payment-cell"><button type="button" class="payment-toggle" onclick="Participants.togglePaid(this)" tabindex="-1"></button></td>
            <td class="row-actions">
                <button class="btn-neutral btn-icon" data-row-action="print" onclick="Printing.participant(this.closest('tr'))" title="${printLabel}" aria-label="${printLabel}" tabindex="-1">${Participants.PRINT_ICON}</button>
                <button class="btn-danger-ghost btn-icon" onclick="Participants.deleteRow(this)" aria-label="✕" tabindex="-1">✕</button>
            </td>`;
    }

    static addRow(data = {}) {
        const tr = document.createElement('tr');
        const classes = [];
        if (!data.lastName) classes.push('empty-row');
        if (data.paid)      classes.push('row-paid');
        tr.className = classes.join(' ');
        const rowData = data.registeredMatches === undefined
            ? { ...data, registeredMatches: Participants.defaultRegistration() }
            : data;
        tr.innerHTML = Participants.buildRowHtml(rowData);
        $('participants-tbody').appendChild(tr);
        Categories.updateBadge(tr);
        Participants.applyColumnVisibility();
        Participants.applyLock(tr, !!data.paid);
        Participants.updatePayment(tr);
        return tr;
    }

    static writeRow(tr, data) {
        Participants.FIELDS.forEach(f => {
            if (data[f.key] === undefined) return; // absent from the update — keep the existing value
            const el = tr.querySelector('.' + f.cls);
            if (!el) return;
            el.value = (data[f.key] ?? '').toString();
        });
        if (data.registeredMatches !== undefined) {
            const group = tr.querySelector('.match-toggle-group');
            if (group) group.innerHTML = Participants.matchTogglesHtml(data.registeredMatches);
        }
        const lastName = tr.querySelector('.field-lastname');
        tr.classList.toggle('empty-row', !(lastName?.value ?? '').trim());
        Categories.updateBadge(tr);
        Participants.applyLock(tr, Participants.isPaid(tr));
        Participants.updatePayment(tr);
    }

    static findRowByLicense(license) {
        const target = Licenses.normalizeLicense(license);
        if (!target) return null;
        for (const tr of $$('#participants-tbody tr')) {
            const candidate = Licenses.normalizeLicense(tr.querySelector('.field-license')?.value || '');
            if (candidate && candidate === target) return tr;
        }
        return null;
    }

    static updateLensState(tr) {
        const lens = tr?.querySelector('.license-search-btn');
        if (!lens) return;
        const licenseInput = tr.querySelector('.field-license');
        const hasLicense = !!(licenseInput && licenseInput.value.trim());
        lens.disabled = hasLicense || LicenseDb.recordCount === 0;
    }

    static onInput(inputEl) {
        const tr = inputEl.closest('tr');
        if (inputEl.classList.contains('field-license')) {
            const cleaned = inputEl.value.replace(/\s+/g, '');
            if (cleaned !== inputEl.value) inputEl.value = cleaned;
            Participants.updateLensState(tr);
        }
        if (inputEl.classList.contains('field-lastname')) {
            if (inputEl.value.trim() !== '') {
                tr.classList.remove('empty-row');
                if (!tr.nextElementSibling) Participants.addRow();
            } else {
                tr.classList.add('empty-row');
            }
        }
        if (inputEl.classList.contains('field-yob')) {
            Categories.updateBadge(tr);
        }
        Participants.handleChanged();
    }

    static otherRowLicenses(currentRow) {
        return [...$$('#participants-tbody tr')]
            .filter(tr => tr !== currentRow)
            .map(tr => tr.querySelector('.field-license')?.value || '')
            .filter(Boolean);
    }

    static async lookupLicense(inputEl) {
        const tr = inputEl.closest('tr');
        if (!tr) return;
        const license = inputEl.value.trim();
        if (!license) return;

        if (Licenses.findDuplicateLicense(license, Participants.otherRowLicenses(tr))) {
            alert(Translations.t('msg.duplicateLicense'));
            inputEl.focus();
            inputEl.select();
            return;
        }

        const last  = tr.querySelector('.field-lastname').value.trim();
        const first = tr.querySelector('.field-firstname').value.trim();
        const yob   = tr.querySelector('.field-yob').value.trim();
        if (last || first || yob) return;

        const record = await LicenseDb.find(license);
        if (!record) return;

        tr.querySelector('.field-lastname').value  = record.lastName;
        tr.querySelector('.field-firstname').value = record.firstName;
        tr.querySelector('.field-yob').value       = record.yearOfBirth;
        tr.classList.remove('empty-row');
        if (!tr.nextElementSibling) Participants.addRow();
        Categories.updateBadge(tr);
        Participants.handleChanged();
    }

    static deleteRow(button) {
        const tr = button.closest('tr');
        if (!tr.classList.contains('empty-row') && !confirm(Translations.t('confirm.deleteRow'))) return;
        tr.remove();
        if (!document.querySelector('#participants-tbody tr')) Participants.addRow();
        Participants.handleChanged();
    }

    static deleteSelected() {
        const rows = Selection.getToolbarTargets();
        if (!rows.length) return;
        if (!confirm(Translations.t('confirm.deleteSelected'))) return;
        rows.forEach(tr => tr.remove());
        if (!document.querySelector('#participants-tbody tr')) Participants.addRow();
        Participants.handleChanged();
    }

    static save() {
        const items = [...$$('#participants-tbody tr:not(.empty-row)')]
            .map(Participants.readRow)
            .filter(p => p.lastName.trim() !== '');
        localStorage.setItem('participants', JSON.stringify({
            version: Backup.PARTICIPANTS_VERSION,
            items,
        }));
    }

    static loadStored() {
        try {
            const raw = localStorage.getItem('participants');
            if (!raw) return [];
            const wrapper = JSON.parse(raw);
            if (Backup.majorOf(wrapper.version) !== Backup.majorOf(Backup.PARTICIPANTS_VERSION)) return [];
            return Array.isArray(wrapper.items) ? wrapper.items : [];
        } catch (_) { return []; }
    }

    static handleChanged() {
        Participants.save();
        Filter.apply();
        Toolbar.updateLabels();
    }

    static refreshDynamicTexts() {
        Participants.FIELDS.filter(f => f.placeholderKey).forEach(f => {
            $$('#participants-tbody .' + f.cls).forEach(input => { input.placeholder = Translations.t(f.placeholderKey); });
        });
        $$('#participants-tbody [data-row-action="print"]').forEach(btn => {
            btn.title = Translations.t('btn.printParticipant');
            btn.setAttribute('aria-label', Translations.t('btn.printParticipant'));
        });
        $$('#participants-tbody .license-search-btn').forEach(btn => {
            btn.title = Translations.t('btn.searchLicense');
            btn.setAttribute('aria-label', Translations.t('btn.searchLicense'));
        });
        Categories.updateAll();
        Toolbar.updateLabels();
    }
}

// -----------------------------------------------------------------------------
// Selection helpers (master checkbox + per-row checkboxes)
// -----------------------------------------------------------------------------

class Selection {
    static getNonEmptyRows() {
        return [...$$('#participants-tbody tr:not(.empty-row)')];
    }

    static getSelectedRows() {
        return [...$$('.row-check:checked')]
            .map(c => c.closest('tr'))
            .filter(tr => tr && !tr.classList.contains('empty-row'));
    }

    static getToolbarTargets() {
        const selected = Selection.getSelectedRows();
        return selected.length > 0 ? selected : Selection.getNonEmptyRows();
    }

    static toggleAll() {
        const shouldCheckAll = Selection.getSelectedRows().length === 0;
        $$('.row-check').forEach(cb => {
            const tr = cb.closest('tr');
            if (tr && !tr.classList.contains('empty-row')) cb.checked = shouldCheckAll;
        });
        Toolbar.updateLabels();
    }
}

// -----------------------------------------------------------------------------
// Filter
// -----------------------------------------------------------------------------

class Filter {
    static apply() {
        const query = ($('filter-input')?.value || '').trim().toLowerCase();
        $$('#participants-tbody tr').forEach(tr => {
            if (!query) {
                tr.classList.remove('filtered-out');
                return;
            }
            if (tr.classList.contains('empty-row')) {
                tr.classList.add('filtered-out');
                return;
            }
            const haystack = [...tr.querySelectorAll('input[type="text"], input[type="number"]')]
                .map(i => i.value.toLowerCase())
                .join(' ');
            tr.classList.toggle('filtered-out', !haystack.includes(query));
        });
    }
}

// -----------------------------------------------------------------------------
// Toolbar
// -----------------------------------------------------------------------------

class Toolbar {
    static BUTTONS = [
        { id: 'btn-toolbar-download', verbKey: 'verb.download', icon: '⤓' },
        { id: 'btn-toolbar-copy',     verbKey: 'verb.copy',     icon: '⧉' },
        { id: 'btn-toolbar-delete',   verbKey: 'verb.delete',   icon: '🗑' },
    ];

    static renderPrintGroup() {
        const group = $('print-group');
        if (!group) return;
        const icon = `<span class="print-group-icon" aria-hidden="true">${Participants.PRINT_ICON}</span>`;
        const matchButtons = Matches.all().map(match => {
            const title = Escape.escapeHtml(Translations.t('btn.printMatch', { title: match.title || match.label }));
            return `<button type="button" class="print-match-btn" onclick="Printing.printMatch('${Escape.escapeHtml(match.key)}')" title="${title}">${Escape.escapeHtml(match.label)}</button>`;
        }).join('');
        const allButton = `<button type="button" class="print-all-btn" onclick="Printing.printAll()">${Escape.escapeHtml(Translations.t('btn.printAll'))}</button>`;
        group.innerHTML = icon + matchButtons + allButton;
    }

    static updateMaster() {
        const master = $('master-check');
        if (!master) return;
        const total    = Selection.getNonEmptyRows().length;
        const selected = Selection.getSelectedRows().length;
        master.checked       = selected > 0 && selected === total;
        master.indeterminate = selected > 0 && selected < total;
    }

    static updateLabels() {
        const selected = Selection.getSelectedRows();
        const count = selected.length > 0 ? String(selected.length) : Translations.t('count.all');
        Toolbar.BUTTONS.forEach(({ id, verbKey, icon }) => {
            const btn = $(id);
            if (!btn) return;
            btn.innerHTML = `<span class="toolbar-btn-icon" aria-hidden="true">${icon}</span>`
                + `<span class="btn-count">${Escape.escapeHtml(count)}</span> ${Escape.escapeHtml(Translations.t(verbKey))}`;
        });
        Toolbar.updateMaster();
    }
}

// -----------------------------------------------------------------------------
// Tabular import/export (CSV download / clipboard copy / CSV import)
// -----------------------------------------------------------------------------

class CsvIO {
    static matchColumns() {
        return Matches.all().map(match => ({ key: match.key, header: `match_${match.matchCode}` }));
    }

    // Applies the file's registration columns onto the existing registrations:
    // matches present in the file are set/cleared by their cell, matches absent
    // from the file keep their current state (so a partial file never wipes them).
    static mergeRegistrations(existingKeys, fileRegistrations) {
        const merged = new Set(existingKeys);
        fileRegistrations.forEach((registered, matchKey) => {
            if (registered) merged.add(matchKey);
            else merged.delete(matchKey);
        });
        return [...merged];
    }

    static buildDelimited(rows, separator, { includeHeader = true } = {}) {
        const cols = Participants.visibleColumns();
        const matchCols = CsvIO.matchColumns();
        const lines = [];
        if (includeHeader) {
            const headers = [...cols.map(f => Participants.fieldHeader(f)), ...matchCols.map(c => c.header)];
            lines.push(headers.map(header => Escape.escapeCsvField(header, separator)).join(separator));
        }
        rows.forEach(tr => {
            const data = Participants.readRow(tr);
            const registered = new Set(data.registeredMatches || []);
            const cells = [...cols.map(f => data[f.key]), ...matchCols.map(c => registered.has(c.key) ? '1' : '0')];
            lines.push(cells.map(cell => Escape.escapeCsvField(cell, separator)).join(separator));
        });
        return lines.join('\r\n');
    }

    static download() {
        const rows = Selection.getToolbarTargets();
        if (!rows.length) return;
        const csv = '﻿' + CsvIO.buildDelimited(rows, ';');
        const filename = `${(Settings.get('eventName') || 'standblatt').replace(/\s+/g, '_')}.csv`;
        triggerDownload(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    }

    static downloadTemplate() {
        const separator = ';';
        const cols = Participants.visibleColumns();
        const matchCols = CsvIO.matchColumns();
        const samples = [
            { lastName: 'Muster', firstName: 'Hans', yearOfBirth: '1990' },
            { lastName: 'Modèle', firstName: 'Jean', yearOfBirth: '1985' },
        ];
        const row = (sample) => [
            ...cols.map(f => sample[f.key] ?? ''),
            ...matchCols.map((c, index) => index === 0 ? '1' : '0'),
        ].map(cell => Escape.escapeCsvField(cell, separator)).join(separator);
        const lines = [
            [...cols.map(f => Participants.fieldHeader(f)), ...matchCols.map(c => c.header)]
                .map(header => Escape.escapeCsvField(header, separator)).join(separator),
            ...samples.map(row),
        ];
        const csv = '﻿' + lines.join('\r\n');
        triggerDownload(`${Translations.t('template.filename')}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    }

    static async copy() {
        const rows = Selection.getToolbarTargets();
        if (!rows.length) return;
        const tsv = CsvIO.buildDelimited(rows, '\t', { includeHeader: false });
        try {
            await navigator.clipboard.writeText(tsv);
        } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = tsv;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    }

    static async import(input) {
        if (!input.files[0]) return;
        const file = input.files[0];
        input.value = '';
        try {
            let text = await readTextFile(file);
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const firstLine = text.split(/\r?\n/, 1)[0];
            const rows = Csv.parseCsv(text, Csv.detectSeparator(firstLine));
            if (rows.length < 2) return;

            // Columns are mapped by their header name (the headers the export and
            // template write), so an import stays correct even if the visible
            // columns changed since export. Each standard field maps by its own
            // header; `match_<matchCode>` columns carry the registrations.
            const header = rows[0].map(cell => cell.trim().toLowerCase());
            const fieldByHeader = new Map();
            Participants.FIELDS.forEach(field => {
                const headerName = Participants.fieldHeader(field).trim().toLowerCase();
                if (headerName) fieldByHeader.set(headerName, field.key);
            });
            const matchByHeader = new Map(CsvIO.matchColumns().map(column => [column.header.toLowerCase(), column.key]));
            const fieldByColumn = header.map(cell => fieldByHeader.get(cell) || null);
            const matchByColumn = header.map(cell => matchByHeader.get(cell) || null);
            const importsRegistrations = matchByColumn.some(Boolean);

            const trailing = document.querySelector('#participants-tbody tr.empty-row');
            if (trailing) trailing.remove();

            let added = 0;
            let updated = 0;
            for (let r = 1; r < rows.length; r++) {
                const data = {};
                fieldByColumn.forEach((fieldKey, c) => {
                    if (fieldKey) data[fieldKey] = (rows[r][c] ?? '').trim();
                });
                if (!data.lastName && !data.firstName) continue;

                const fileRegistrations = new Map(); // matchKey -> registered?
                matchByColumn.forEach((matchKey, c) => {
                    if (!matchKey) return;
                    const cell = (rows[r][c] ?? '').trim();
                    fileRegistrations.set(matchKey, cell !== '' && cell !== '0');
                });

                const existing = Participants.findRowByLicense(data.license);
                if (existing) {
                    if (importsRegistrations) {
                        data.registeredMatches = CsvIO.mergeRegistrations(Participants.readRegisteredMatches(existing), fileRegistrations);
                    }
                    Participants.writeRow(existing, data);
                    updated++;
                } else {
                    if (importsRegistrations) {
                        data.registeredMatches = [...fileRegistrations].filter(([, on]) => on).map(([key]) => key);
                    }
                    Participants.addRow(data);
                    added++;
                }
            }

            Participants.addRow(); // restore trailing empty row
            Participants.handleChanged();
            alert(Translations.t('msg.csvImported', { added, updated }));
        } catch (_) {
            alert(Translations.t('msg.csvImportFailed'));
        }
    }
}

// -----------------------------------------------------------------------------
// Printing
// -----------------------------------------------------------------------------

class Printing {
    static printMatch(matchKey) {
        Printing.run(MatchOrder.buildPrintPairs(Printing.selectedParticipants(), Matches.all(), matchKey));
    }

    static printAll() {
        Printing.run(MatchOrder.buildPrintPairs(Printing.selectedParticipants(), Matches.all(), null));
    }

    static participant(rowEl) {
        const participant = Participants.readRow(rowEl);
        if (!participant.paid) { alert(Translations.t('msg.paymentRequired')); return; }
        Printing.run(MatchOrder.buildPrintPairs([participant], Matches.all(), null));
    }

    // Only confirmed (paid) participants print; unpaid ones are skipped silently.
    static selectedParticipants() {
        return Selection.getToolbarTargets().map(Participants.readRow).filter(participant => participant.paid);
    }

    static printToken = 0;

    static async run(pairs) {
        if (!pairs.length) { alert(Translations.t('msg.nothingToPrint')); return; }

        const token = ++Printing.printToken;
        const resolveScorecard = Scorecards.resolver();
        const backdrops = await Scorecards.rasterizeBackdrops(pairs, resolveScorecard);
        if (token !== Printing.printToken) return; // superseded by a newer print request

        const container = $('print-container');
        container.innerHTML = '';
        pairs.forEach(({ participant, match }) => {
            const scorecard = resolveScorecard(match);
            if (!scorecard) return;
            container.appendChild(Scorecards.buildSheet(scorecard, participant, match, backdrops.get(scorecard.key)));
        });

        await Printing.imagesReady(container);
        if (token !== Printing.printToken) return;
        window.print();
    }

    static imagesReady(container) {
        const images = [...container.querySelectorAll('img')];
        return Promise.all(images.map(image => image.complete
            ? Promise.resolve()
            : new Promise(resolve => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
            })));
    }
}

// -----------------------------------------------------------------------------
// Backup (full settings + participants JSON) + reset
// -----------------------------------------------------------------------------

class Backup {
    // Bump the major part when the shape changes incompatibly,
    // the minor part when fields are added in a backward-compatible way.
    static SETTINGS_VERSION     = '2.0';
    static PARTICIPANTS_VERSION = '2.0';

    static majorOf(value) {
        return parseInt(String(value || '0').split('.')[0], 10) || 0;
    }

    static assertCompatibleMajor(incomingVersion, expectedVersion, sectionLabel) {
        if (Backup.majorOf(incomingVersion) !== Backup.majorOf(expectedVersion)) {
            throw new Error(Translations.t('msg.importIncompatible', {
                section: sectionLabel,
                version: incomingVersion,
            }));
        }
    }

    static readWrapper(storageKey, currentVersion, payloadKey, emptyPayload) {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return { version: currentVersion, [payloadKey]: emptyPayload };
            const wrapper = JSON.parse(raw);
            return {
                version: wrapper.version,
                [payloadKey]: wrapper[payloadKey] ?? emptyPayload,
            };
        } catch (_) {
            return { version: currentVersion, [payloadKey]: emptyPayload };
        }
    }

    static export() {
        const data = {
            settings:     Backup.readWrapper('settings',     Backup.SETTINGS_VERSION,     'data',  {}),
            participants: Backup.readWrapper('participants', Backup.PARTICIPANTS_VERSION, 'items', []),
        };
        const slug = (Settings.get('eventName') || 'event')
            .toLowerCase()
            .normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'event';
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}`;
        triggerDownload(`${slug}_${ts}.openrangeoffice`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' }));
    }

    static import(input) {
        if (!input.files[0]) return;
        if (!confirm(Translations.t('confirm.importOverwrite'))) { input.value = ''; return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                if (data.settings && data.settings.data) {
                    Backup.assertCompatibleMajor(data.settings.version, Backup.SETTINGS_VERSION, 'settings');
                    localStorage.setItem('settings', JSON.stringify({
                        version: data.settings.version,
                        data: data.settings.data,
                    }));
                }
                if (data.participants && Array.isArray(data.participants.items)) {
                    Backup.assertCompatibleMajor(data.participants.version, Backup.PARTICIPANTS_VERSION, 'participants');
                    localStorage.setItem('participants', JSON.stringify({
                        version: data.participants.version,
                        items: data.participants.items,
                    }));
                }
                location.reload();
            } catch (err) {
                alert(err.message || Translations.t('msg.importFailed'));
                input.value = '';
            }
        };
        reader.readAsText(input.files[0]);
    }

    static clearAll() {
        if (!confirm(Translations.t('confirm.clearAll'))) return;
        const userPrefs = UserSettings.read();
        localStorage.clear();
        UserSettings.patch(userPrefs); // preserve language and any future user prefs
        sessionStorage.setItem('openSettingsOnLoad', '1');
        location.reload();
    }
}

// -----------------------------------------------------------------------------
// License lookup database — IndexedDB-backed, deliberately outside the event
// envelope so the ~10MB SSV roster never bloats `.openrangeoffice` exports.
// -----------------------------------------------------------------------------

class LicenseDb {
    static DB_NAME = 'openrangeoffice-licenses';
    static STORE   = 'licenses';
    static VERSION = 2;
    static SEARCH_LIMIT  = 50;
    static SEARCH_DEBOUNCE_MS = 150;

    static REQUIRED_HEADERS = {
        license:     'lizenznummer',
        lastName:    'nachname',
        firstName:   'vorname',
        birthDate:   'geburtsdatum',
        vereinsort:  'vereinsort',
        vereinsname: 'vereinsname',
    };

    static recordCount  = 0;
    static activeRow    = null;
    static searchTimer  = null;
    static searchSeq    = 0;

    static open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(LicenseDb.DB_NAME, LicenseDb.VERSION);
            request.onupgradeneeded = (event) => {
                const db = request.result;
                if (!db.objectStoreNames.contains(LicenseDb.STORE)) {
                    db.createObjectStore(LicenseDb.STORE, { keyPath: 'license' });
                }
                // Any version bump invalidates the cached roster; user re-imports.
                event.target.transaction.objectStore(LicenseDb.STORE).clear();
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror   = () => reject(request.error);
        });
    }

    static async count() {
        try {
            const db = await LicenseDb.open();
            return await new Promise((resolve, reject) => {
                const request = db.transaction(LicenseDb.STORE, 'readonly').objectStore(LicenseDb.STORE).count();
                request.onsuccess = () => { resolve(request.result); db.close(); };
                request.onerror   = () => { reject(request.error); db.close(); };
            });
        } catch (_) {
            return 0;
        }
    }

    static async find(rawLicense) {
        const license = Licenses.normalizeLicense(rawLicense);
        if (!license) return null;
        try {
            const db = await LicenseDb.open();
            return await new Promise((resolve, reject) => {
                const request = db.transaction(LicenseDb.STORE, 'readonly').objectStore(LicenseDb.STORE).get(license);
                request.onsuccess = () => { resolve(request.result || null); db.close(); };
                request.onerror   = () => { reject(request.error); db.close(); };
            });
        } catch (_) {
            return null;
        }
    }

    static async clear() {
        const db = await LicenseDb.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(LicenseDb.STORE, 'readwrite');
            transaction.objectStore(LicenseDb.STORE).clear();
            transaction.oncomplete = () => { resolve(); db.close(); };
            transaction.onerror    = () => { reject(transaction.error); db.close(); };
        });
    }

    static async importFromFile(file) {
        let text = await readTextFile(file);
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const firstLine = text.split(/\r?\n/, 1)[0];
        const rows = Csv.parseCsv(text, Csv.detectSeparator(firstLine));
        if (rows.length < 2) return 0;

        const headers = rows[0].map(h => h.trim().toLowerCase());
        const indexes = Object.fromEntries(
            Object.entries(LicenseDb.REQUIRED_HEADERS).map(([key, header]) => [key, headers.indexOf(header)])
        );
        if (Object.values(indexes).some(i => i < 0)) {
            throw new Error('missing required SSV headers');
        }

        const db = await LicenseDb.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(LicenseDb.STORE, 'readwrite');
            const store = transaction.objectStore(LicenseDb.STORE);
            store.clear();
            let count = 0;
            for (let r = 1; r < rows.length; r++) {
                const row = rows[r];
                const license = Licenses.normalizeLicense(row[indexes.license]);
                if (!license) continue;
                store.put({
                    license,
                    lastName:    (row[indexes.lastName]    || '').trim(),
                    firstName:   (row[indexes.firstName]   || '').trim(),
                    yearOfBirth: Licenses.parseSwissDateYear(row[indexes.birthDate]),
                    vereinsort:  (row[indexes.vereinsort]  || '').trim(),
                    vereinsname: (row[indexes.vereinsname] || '').trim(),
                });
                count++;
            }
            transaction.oncomplete = () => { resolve(count); db.close(); };
            transaction.onerror    = () => { reject(transaction.error); db.close(); };
        });
    }

    static async refreshStatus() {
        const count = await LicenseDb.count();
        LicenseDb.recordCount = count;
        $$('#participants-tbody tr').forEach(tr => Participants.updateLensState(tr));
        const status   = $('license-db-status');
        const clearBtn = $('license-db-clear-button');
        if (!status) return;
        if (count > 0) {
            status.textContent = Translations.t('msg.licenseDbStatusLoaded', { count });
            if (clearBtn) clearBtn.style.display = '';
        } else {
            status.textContent = Translations.t('msg.licenseDbStatusEmpty');
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    static async searchByName(query, limit = LicenseDb.SEARCH_LIMIT) {
        const terms = Licenses.tokenizeQuery(query);
        if (terms.length === 0) return [];
        let db;
        try { db = await LicenseDb.open(); } catch (_) { return []; }
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(LicenseDb.STORE, 'readonly');
            const cursorReq   = transaction.objectStore(LicenseDb.STORE).openCursor();
            const results = [];
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor || results.length >= limit) {
                    resolve(results);
                    db.close();
                    return;
                }
                if (Licenses.recordMatchesTerms(cursor.value, terms)) results.push(cursor.value);
                cursor.continue();
            };
            cursorReq.onerror = () => { reject(cursorReq.error); db.close(); };
        });
    }

    static openSearch(triggerButton) {
        LicenseDb.activeRow = triggerButton.closest('tr');
        const dialog = $('license-search-dialog');
        const input  = $('license-search-input');
        const tbody  = $('license-search-results-body');
        const empty  = $('license-search-empty');
        input.value = '';
        tbody.innerHTML = '';
        if (LicenseDb.recordCount === 0) {
            empty.textContent = Translations.t('dialog.licenseSearch.empty');
            empty.classList.remove('hidden');
            input.disabled = true;
        } else {
            empty.classList.add('hidden');
            input.disabled = false;
        }
        dialog.showModal();
        if (LicenseDb.recordCount > 0) input.focus();
    }

    static handleSearchInput() {
        clearTimeout(LicenseDb.searchTimer);
        LicenseDb.searchTimer = setTimeout(LicenseDb.runSearch, LicenseDb.SEARCH_DEBOUNCE_MS);
    }

    static async runSearch() {
        const query = $('license-search-input').value;
        const tbody = $('license-search-results-body');
        const empty = $('license-search-empty');
        if (!query.trim()) {
            tbody.innerHTML = '';
            empty.classList.add('hidden');
            return;
        }
        const seq = ++LicenseDb.searchSeq;
        const results = await LicenseDb.searchByName(query);
        if (seq !== LicenseDb.searchSeq) return; // stale
        tbody.innerHTML = results.map(r => `<tr data-license="${Escape.escapeHtml(r.license)}" onclick="LicenseDb.applySearchResult(this)">
            <td>${Escape.escapeHtml(r.license)}</td>
            <td>${Escape.escapeHtml(r.lastName)}</td>
            <td>${Escape.escapeHtml(r.firstName)}</td>
            <td>${Escape.escapeHtml(r.vereinsort  || '')}</td>
            <td>${Escape.escapeHtml(r.vereinsname || '')}</td>
        </tr>`).join('');
        if (results.length === 0) {
            empty.textContent = Translations.t('dialog.licenseSearch.noResults');
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
        }
    }

    static async applySearchResult(rowEl) {
        const license = rowEl.dataset.license;
        $('license-search-dialog').close();
        if (!license || !LicenseDb.activeRow) return;
        const tr = LicenseDb.activeRow;
        LicenseDb.activeRow = null;
        const licenseInput = tr.querySelector('.field-license');
        if (!licenseInput) return;
        licenseInput.value = license;
        Participants.updateLensState(tr);
        // Reuse the existing license → name/firstname/yob lookup so behaviour stays consistent.
        await Participants.lookupLicense(licenseInput);
    }

    static async importViaInput(input) {
        if (!input.files[0]) return;
        const file = input.files[0];
        input.value = '';
        try {
            const count = await LicenseDb.importFromFile(file);
            await LicenseDb.refreshStatus();
            alert(Translations.t('msg.licenseDbImported', { count }));
        } catch (_) {
            await LicenseDb.refreshStatus();
            alert(Translations.t('msg.licenseDbImportFailed'));
        }
    }

    static async clearWithConfirm() {
        if (!confirm(Translations.t('confirm.licenseDbClear'))) return;
        await LicenseDb.clear();
        await LicenseDb.refreshStatus();
    }
}

// -----------------------------------------------------------------------------
// Service worker registration + update prompt
//
// A waiting SW means the browser has fetched a new sw.js and installed it,
// but the old one is still controlling the page. We ask the user before
// taking the new one — useful during a live event where reloads are costly.
// "Cancel" defers the prompt for DEFER_DAYS; the user can also force a check
// from settings (which clears the defer first).
// -----------------------------------------------------------------------------

class Updates {
    static DEFER_DAYS = 3;
    static promptOpen = false;

    static deferUpdates() {
        UserSettings.patch({ updateDeferUntil: UpdateTime.computeDeferUntil(Date.now(), Updates.DEFER_DAYS) });
    }

    static promptAndApply(waitingWorker) {
        if (Updates.promptOpen) return;
        if (!UpdateTime.isUpdatePromptDue(UserSettings.read().updateDeferUntil, Date.now())) return;
        Updates.promptOpen = true;
        try {
            if (confirm(Translations.t('update.confirmNow'))) {
                navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
                waitingWorker.postMessage({ type: 'SKIP_WAITING' });
            } else {
                Updates.deferUpdates();
            }
        } finally {
            Updates.promptOpen = false;
        }
    }

    static watch(registration) {
        const considerWorker = (worker) => {
            if (!worker) return;
            const check = () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    Updates.promptAndApply(worker);
                }
            };
            check();
            worker.addEventListener('statechange', check);
        };
        considerWorker(registration.waiting);
        registration.addEventListener('updatefound', () => considerWorker(registration.installing));
    }

    static async checkNow() {
        if (!('serviceWorker' in navigator)) {
            alert(Translations.t('update.checkFailed'));
            return;
        }
        try {
            UserSettings.patch({ updateDeferUntil: 0 });
            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration) { alert(Translations.t('update.checkFailed')); return; }
            await registration.update();
            if (registration.waiting) {
                Updates.promptAndApply(registration.waiting);
            } else if (!registration.installing) {
                alert(Translations.t('update.upToDate'));
            }
            // installing case: the statechange listener installed by watch()
            // will run promptAndApply once it transitions to 'installed'.
        } catch (_) {
            alert(Translations.t('update.checkFailed'));
        }
    }
}

const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
        .then((registration) => {
            Updates.watch(registration);
            // Force a fresh fetch of sw.js on every page load so the cache-first
            // fetch handler doesn't keep us on a stale version indefinitely.
            registration.update().catch(() => {});
        })
        .catch(() => {});
};

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

class App {
    static populateLanguageSelector() {
        const select = $('language-select');
        select.value = Translations.getLanguage();
        select.addEventListener('change', () => Translations.set(select.value));
    }

    static configurePdfWorker() {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'src/vendor/pdf.worker.min.js';
        }
    }

    static init() {
        Migrations.run();
        Translations.apply();
        App.configurePdfWorker();
        Scorecards.seedIfEmpty();
        Matches.seedIfEmpty();
        Settings.load();
        Participants.applyColumnVisibility();
        App.populateLanguageSelector();
        Logo.updatePreview();
        Matches.renderSettings();
        Scorecards.renderSettings();
        Toolbar.renderPrintGroup();

        Participants.loadStored().forEach(Participants.addRow);
        Participants.addRow(); // trailing empty row
        Toolbar.updateLabels();
        LicenseDb.refreshStatus();

        if (sessionStorage.getItem('openSettingsOnLoad')) {
            sessionStorage.removeItem('openSettingsOnLoad');
            Tabs.switch('settings');
        }
    }
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        const tr = document.activeElement?.closest?.('#participants-tbody tr');
        if (tr && !tr.classList.contains('empty-row')) {
            e.preventDefault();
            Printing.participant(tr);
        }
    }
});

window.addEventListener('load', registerServiceWorker);
document.addEventListener('DOMContentLoaded', App.init);

// Expose classes for inline HTML handlers (onclick / oninput / onchange).
Object.assign(window, {
    Translations, Settings, Logo, Tabs, Categories, Barcodes, Matches, Scorecards,
    Participants, Selection, Filter, Toolbar, CsvIO, Backup, Printing, Updates, LicenseDb,
});
