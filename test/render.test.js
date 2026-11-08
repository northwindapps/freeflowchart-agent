import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../lib/render.js';

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
