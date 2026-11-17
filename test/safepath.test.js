import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkOutputPath } from '../lib/safepath.js';
import { toMarkdown } from '../lib/markdown.js';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffc-safepath-')); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

test('allows new chart files in ordinary folders, including new subfolders', () => {
    for (const [p, kind] of [['a.png', 'png'], ['b.pdf', 'pdf'], ['c.md', 'md'], ['d.markdown', 'md'], ['x/y/E.PNG', 'png']]) {
        assert.equal(checkOutputPath(path.join(dir, p), kind), path.join(dir, p));
    }
});

test('extension must match the format', () => {
    for (const [p, kind] of [['a.txt', 'png'], ['a.png', 'pdf'], ['zshrc', 'md'], ['run.sh', 'md'], ['a.md', 'png']]) {
        assert.throws(() => checkOutputPath(path.join(dir, p), kind), /must end in/, p);
    }
});

test('rejects hidden files and folders, including via ..', () => {
    const home = os.homedir();
    for (const p of [path.join(home, '.zshrc.md'), path.join(home, '.ssh', 'x.png'),
        path.join(dir, 'sub', '..', '.hidden', 'a.md'), path.join(dir, '.a.png')]) {
        assert.throws(() => checkOutputPath(p, path.extname(p).slice(1)), /hidden/, p);
    }
});

test('rejects system folders', { skip: process.platform === 'win32' }, () => {
    for (const p of ['/etc/x.md', '/usr/local/bin/x.png', '/System/a.pdf', `${dir}/${"../".repeat(30)}etc/x.md`]) {
        assert.throws(() => checkOutputPath(p, path.extname(p).slice(1)), /system/, p);
    }
});

test('rejects symlinks that lead into hidden or system folders', { skip: process.platform === 'win32' }, () => {
    const hidden = path.join(dir, '.secret');
    fs.mkdirSync(hidden);
    fs.symlinkSync(hidden, path.join(dir, 'link'));
    assert.throws(() => checkOutputPath(path.join(dir, 'link', 'a.md'), 'md'), /hidden/);
    fs.symlinkSync('/etc', path.join(dir, 'etclink'));
    assert.throws(() => checkOutputPath(path.join(dir, 'etclink', 'new', 'a.md'), 'md'), /system/);
});

test('rejects a symlink as the target file', { skip: process.platform === 'win32' }, () => {
    const real = path.join(dir, 'real.png');
    fs.writeFileSync(real, PNG);
    fs.symlinkSync(real, path.join(dir, 'alias.png'));
    assert.throws(() => checkOutputPath(path.join(dir, 'alias.png'), 'png'), /not a regular file/);
});

test('overwrites only files freeflowchart produced', () => {
    const own = path.join(dir, 'own.md');
    fs.writeFileSync(own, toMarkdown('a\nendflow', { title: 'T' }));
    assert.equal(checkOutputPath(own, 'md'), own);

    const readme = path.join(dir, 'README.md');
    fs.writeFileSync(readme, '# My project\n\nImportant notes\n');
    assert.throws(() => checkOutputPath(readme, 'md'), /not created by freeflowchart/);

    const png = path.join(dir, 'chart.png');
    fs.writeFileSync(png, PNG);
    assert.equal(checkOutputPath(png, 'png'), png);
    const fake = path.join(dir, 'fake.png');
    fs.writeFileSync(fake, 'not an image');
    assert.throws(() => checkOutputPath(fake, 'png'), /not created by freeflowchart/);

    const pdf = path.join(dir, 'doc.pdf');
    fs.writeFileSync(pdf, '%PDF-1.7\n');
    assert.equal(checkOutputPath(pdf, 'pdf'), pdf);
});

test('rejects empty and NUL paths', () => {
    assert.throws(() => checkOutputPath('', 'png'), /empty or invalid/);
    assert.throws(() => checkOutputPath('a\0.png', 'png'), /empty or invalid/);
});
