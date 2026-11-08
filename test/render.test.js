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
