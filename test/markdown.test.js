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

test('splitPages matches the renderer rules', async () => {
    const { splitPages } = await import('../lib/markdown.js');
    const s = 'pagebreak Plan A\na\nif x?\nthen\npagebreak no\nb\nendthen\nendif\npagebreak\nnone\npagebreak\nc';
    assert.deepEqual(splitPages(s).map((p) => p.name), ['Plan A', 'Page 2']);
    assert.deepEqual(splitPages('a\nb').map((p) => p.name), ['Page 1']);
});

test('multi-page markdown has a section and image per page, and round-trips', () => {
    const s = 'pagebreak Plan A\na\nendflow\npagebreak Plan B\nb';
    const md = toMarkdown(s, { title: 'Plans', imagePaths: ['p-1.png', 'p-2.png'] });
    assert.match(md, /## Plan A\n\n!\[Plan A\]\(p-1\.png\)\n\n1\. a\n2\. End/);
    assert.match(md, /## Plan B\n\n!\[Plan B\]\(p-2\.png\)\n\n1\. b/);
    assert.equal(extractScript(md), s);
});

test('pageFile numbers only multi-page output', async () => {
    const { pageFile } = await import('../lib/markdown.js');
    assert.equal(pageFile('/a/chart.png', 1, 1), '/a/chart.png');
    assert.equal(pageFile('/a/chart.png', 2, 3), '/a/chart-2.png');
});
