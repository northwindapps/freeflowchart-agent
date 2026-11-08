import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { tokenize } from '../lib/tokenize.js';

// Parity check against the web app's original tokenizer (sibling checkout).
const MAIN_JS = new URL('../../freeflowchart/main.js', import.meta.url);
const haveOriginal = fs.existsSync(MAIN_JS);

function originalTokenize(script) {
    const store = {};
    const ctx = {
        console: { log() {} },
        sessionStorage: { setItem: (k, v) => { store[k] = v; } },
        window: { location: {}, addEventListener() {} },
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(MAIN_JS, 'utf8'), ctx);
    ctx.getValue(script.replace(/\n\r?/g, ' <>') + '<>');
    return JSON.parse(store.src);
}

const SAMPLES = [
    'start\nif ok?\n  then\n    do yes\n  endthen\nelse\n    do no\n  endelse\nendif\nfinish (https://example.com)\nendflow done',
    'start\ndb Product Catalog <- file(products.xlsx)\nselect item\ncheckout\nendflow done',
    'if2 member?\n  then\n    apply discount\n  endthen\nendif\nif2 coupon?\n  then\n    apply coupon\n  endthen\nendif\nprocess payment\nendflow',
    'none of the above\nfile spec.pdf\nendprocess\n\n   indented   label  \nendflow',
];

test('matches the web app tokenizer', { skip: !haveOriginal && 'freeflowchart checkout not found' }, () => {
    for (const s of SAMPLES) assert.deepEqual(tokenize(s), originalTokenize(s), s);
});

test('keyword at line start splits off the label', () => {
    assert.deepEqual(tokenize('if ok?').map((t) => t.trim()).filter(Boolean), ['if', 'ok?']);
    assert.deepEqual(tokenize('none of these').map((t) => t.trim()).filter(Boolean), ['none', 'of these']);
});

test('tracks source lines', async () => {
    const { tokenizeWithLines } = await import('../lib/tokenize.js');
    const t = tokenizeWithLines('start\n\nif ok?\n  then\nx').filter((t) => t.text.trim());
    assert.deepEqual(t.map((x) => [x.text.trim(), x.line]), [['start', 1], ['if', 3], ['ok?', 3], ['then', 4], ['x', 5]]);
});
