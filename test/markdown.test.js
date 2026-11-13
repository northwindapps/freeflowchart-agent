import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toOutline, parseSteps, extractScript } from '../lib/markdown.js';

const IF_ELSE = [
    'start',
    'if member?',
    '  then',
    '    apply discount',
    '    endflow discount applied',
    '  endthen',
    'else',
    '    regular price',
    '  endelse',
    'endif',
    'db Orders <- file(orders.csv)',
    'endflow',
].join('\n');

test('outline follows the if/else structure', () => {
    assert.deepEqual(toOutline(parseSteps(IF_ELSE)), [
        '1. start',
        '2. **Decision:** member?',
        '   - **Yes:**',
        '     1. apply discount',
        '     2. End: discount applied',
        '   - **No:**',
        '     1. regular price',
        '3. Database: Orders (input: orders.csv)',
        '4. End',
    ]);
});

test('if2 without else, nested decisions, spacers', () => {
    const s = 'if2 a?\nthen\nif b?\nthen\nnone\nendthen\nendif\nx <- file(f.pdf)\nendthen\nendif\nfile spec.pdf';
    assert.deepEqual(toOutline(parseSteps(s)), [
        '1. **Decision:** a?',
        '   - **Yes:**',
        '     1. **Decision:** b?',
        '        - **Yes:** continue to the next step',
        '        - **No:** continue to the next step',
        '     2. x (input: f.pdf)',
        '   - **No:** continue to the next step',
        '2. File: spec.pdf',
    ]);
});

test('unbalanced scripts do not throw', () => {
    for (const s of ['endif\nendthen\nx', 'if a?\nthen\ny', 'else\nendelse']) {
        assert.ok(Array.isArray(toOutline(parseSteps(s))), s);
    }
});

test('markdown round-trips the FlowScript source', () => {
    const md = toMarkdown(IF_ELSE, { title: 'Checkout', imagePath: 'checkout flow.png' });
    assert.match(md, /^# Checkout\n/);
    assert.match(md, /!\[Checkout\]\(<checkout flow\.png>\)/);
    assert.match(md, /## Steps\n\n1\. start/);
    assert.equal(extractScript(md), IF_ELSE);
});

test('script containing a code fence still round-trips', () => {
    const s = 'print ```x```\nendflow';
    assert.equal(extractScript(toMarkdown(s)), s);
});

test('extractScript rejects files without a flowscript block', () => {
    assert.throws(() => extractScript('# hi\n\n```js\nx\n```\n'), /No ```flowscript/);
});
