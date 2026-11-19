import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRenderer, isRendererFile } from '../lib/render.js';

const r = createRenderer();
after(() => r.close());

const SCRIPT = 'start\nif ok?\n  then\n    yes path\n  endthen\nelse\n    no path\n  endelse\nendif\nendflow';

test('renders PNG', async () => {
    const out = await r.render(SCRIPT, { format: 'png', scale: 1 });
    assert.equal(out.buffer.subarray(1, 4).toString(), 'PNG');
    assert.ok(out.width > 500 && out.height > 200, `${out.width}x${out.height}`);
});

test('renders PDF', async () => {
    const out = await r.render(SCRIPT, { format: 'pdf', scale: 1 });
    assert.equal(out.buffer.subarray(0, 5).toString(), '%PDF-');
});

test('rejects empty script and bad format', async () => {
    await assert.rejects(r.render('   '), /empty/);
    await assert.rejects(r.render('a', { format: 'gif' }), /Unsupported/);
});

test('reports layout with source lines; chained if2 has no crossings', async () => {
    const out = await r.render('if2 member?\n  then\n    apply discount\n  endthen\nendif\npay\nendflow', { scale: 1 });
    const { nodes, edges, issues } = out.layout;
    const byLabel = Object.fromEntries(nodes.map((n) => [n.label, n]));
    assert.equal(byLabel['member?'].type, 'decision');
    assert.equal(byLabel['member?'].line, 1);
    assert.equal(byLabel['apply discount'].line, 3);
    assert.equal(byLabel['pay'].line, 6);
    for (const n of nodes) {
        assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= out.width && n.y + n.height <= out.height, n.label);
    }
    assert.ok(edges.some((e) => e.from === byLabel['member?'].id && e.to === byLabel['pay'].id));
    assert.deepEqual(issues, []);
});

test('if/else merge and branch-first attached file have no issues', async () => {
    for (const s of [
        'if start?\n  then\n    a\n  endthen\nelse\n    b\n  endelse\nendif\nendflow',
        'x\nif ok?\n  then\n    a\n  endthen\nelse\n    b <- file(doc.pdf)\n    c\n    endflow\n  endelse\nendif',
    ]) {
        const out = await r.render(s, { scale: 1 });
        assert.deepEqual(out.layout.issues, [], s);
    }
});

test('clean chart has no issues', async () => {
    const out = await r.render('a\nb\nendflow', { scale: 1 });
    assert.deepEqual(out.layout.issues, []);
});

test('if without else: no-path to next node has no crossings', async () => {
    const out = await r.render('start\nif ok?\n  then\n    yes\n  endthen\nendif\nendflow', { scale: 1 });
    assert.deepEqual(out.layout.issues, []);
});

const PAGES = [
    'pagebreak Plan A', 'start', 'if ok?', '  then', '    pagebreak Ignored', '    yes', '  endthen', 'endif', 'endflow done',
    'pagebreak Plan B', 'alpha', 'endflow',
    'pagebreak', 'none',
    'pagebreak', 'gamma',
].join('\n');

test('pagebreak splits into independent pages', async () => {
    const out = await r.render(PAGES, { scale: 1 });
    assert.deepEqual(out.pages.map((p) => [p.page, p.name]), [[1, 'Plan A'], [2, 'Plan B'], [3, 'Page 3']]);
    assert.equal(out.pageCount, 3);
    const labels = (p) => p.layout.nodes.map((n) => `${n.label}@${n.line}`);
    assert.deepEqual(labels(out.pages[0]), ['start@2', 'ok?@3', 'yes@6', 'done@9']);
    assert.deepEqual(labels(out.pages[1]), ['alpha@11', '@12']);
    assert.deepEqual(labels(out.pages[2]), ['gamma@16']);
    for (const p of out.pages) assert.deepEqual(p.warnings, []);
});

test('single page and multi-page PDF', async () => {
    const one = await r.render(PAGES, { scale: 1, page: 2 });
    assert.equal(one.pages.length, 1);
    assert.equal(one.name, 'Plan B');
    const pdf = await r.render(PAGES, { scale: 1, format: 'pdf' });
    const boxes = [...pdf.buffer.toString('latin1').matchAll(/MediaBox\s*\[([^\]]+)\]/g)];
    assert.equal(boxes.length, 3);
});

test('script without pagebreak is one page', async () => {
    const out = await r.render('a\nendflow', { scale: 1 });
    assert.equal(out.pages.length, 1);
    assert.equal(out.pageCount, 1);
});

test('only the bundled renderer files may load (no local file reads via labels)', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
    const url = (p) => pathToFileURL(p).href;
    for (const f of ['render.html', 'chart.js', 'connect.js', 'style.css']) {
        assert.ok(isRendererFile(url(path.join(dir, f)) + '?page=2'), f);
    }
    for (const u of [
        url(path.join(dir, '..', 'package.json')), url(dir) + '/', url(path.join(dir, 'SOURCE_COMMIT')),
        url(dir) + '/../package.json', url(dir) + '/%2e%2e/package.json', 'file:///etc/passwd',
        'file://host/share/x', 'data:text/html,<p>x</p>', 'https://example.com/a.png', 'not a url',
    ]) {
        assert.equal(isRendererFile(u), false, u);
    }
});

test('a label embedding a local file still renders, without the file', async () => {
    const out = await r.render('start\n<iframe src="file:///etc/hosts"></iframe>\n<img src="file:///etc/hosts">\nendflow',
        { format: 'png', scale: 1 });
    assert.equal(out.buffer.subarray(1, 4).toString(), 'PNG');
});
