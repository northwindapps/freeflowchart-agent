// Output-path checks for the MCP server, where paths may come from an agent
// acting on untrusted content. Writes may go anywhere a user would save a chart,
// but only as chart files, never into hidden or system locations, and never
// over a file that freeflowchart did not produce.
import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = { png: ['.png'], pdf: ['.pdf'], md: ['.md', '.markdown'] };

const SYSTEM_DIRS = process.platform === 'win32'
    ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
        process.env.ProgramData].filter(Boolean)
    : ['/bin', '/sbin', '/usr', '/etc', '/dev', '/proc', '/sys', '/boot', '/lib', '/lib64', '/opt',
        '/System', '/Library', '/Applications', '/private/etc', '/private/var/db'];

/**
 * Resolve and validate an output path. Returns the absolute path or throws.
 * kind: 'png' | 'pdf' | 'md'
 */
export function checkOutputPath(target, kind) {
    if (typeof target !== 'string' || !target.trim() || target.includes('\0')) {
        throw new Error('Output path is empty or invalid');
    }
    const abs = path.resolve(target);
    const allowed = EXTENSIONS[kind];
    if (!allowed.includes(path.extname(abs).toLowerCase())) {
        throw new Error(`Refusing to write ${kind.toUpperCase()} output to "${abs}": ` +
            `the file name must end in ${allowed.join(' or ')}`);
    }
    for (const p of new Set([abs, realTarget(abs)])) {
        if (isHidden(p)) {
            throw new Error(`Refusing to write to "${abs}": hidden files and folders (starting with ".") are not allowed`);
        }
        if (isSystem(p)) throw new Error(`Refusing to write to "${abs}": system folders are not allowed`);
    }
    checkOverwrite(abs, kind);
    return abs;
}

// The path with symlinks resolved, also when the file or its folders don't exist yet.
function realTarget(abs) {
    let dir = abs;
    const rest = [];
    while (!fs.existsSync(dir)) {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        rest.unshift(path.basename(dir));
        dir = parent;
    }
    try {
        return path.join(fs.realpathSync(dir), ...rest);
    } catch {
        return abs;
    }
}

function isHidden(p) {
    return path.resolve(p).split(path.sep).some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..');
}

function isSystem(p) {
    const norm = (s) => (process.platform === 'win32' ? path.resolve(s).toLowerCase() : path.resolve(s));
    const target = norm(p);
    return SYSTEM_DIRS.some((d) => target === norm(d) || target.startsWith(norm(d) + path.sep));
}

function checkOverwrite(abs, kind) {
    let st;
    try {
        st = fs.lstatSync(abs);
    } catch {
        return; // new file
    }
    if (!st.isFile()) throw new Error(`Refusing to overwrite "${abs}": it is not a regular file`);
    if (!isOwnOutput(abs, kind)) {
        throw new Error(`Refusing to overwrite "${abs}": it exists and was not created by freeflowchart. ` +
            'Choose a new file name or remove the file first.');
    }
}

function isOwnOutput(abs, kind) {
    const fd = fs.openSync(abs, 'r');
    try {
        if (kind === 'md') {
            const text = fs.readFileSync(fd, 'utf8');
            return /^#.*\n/.test(text) && /^`{3,}flowscript\s*$/m.test(text);
        }
        const head = Buffer.alloc(8);
        fs.readSync(fd, head, 0, 8, 0);
        if (kind === 'png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        return head.subarray(0, 5).toString('latin1') === '%PDF-';
    } finally {
        fs.closeSync(fd);
    }
}
