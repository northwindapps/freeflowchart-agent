// Markdown export: an image link, a step outline built from the script's
// structure, and the FlowScript source so agents can edit and re-render it.
import path from 'node:path';
import { RESERVED_WORDS } from './tokenize.js';

/** Parse FlowScript lines into a tree of steps (sequence + nested decisions). */
export function parseSteps(script) {
    const root = [];
    const stack = [{ items: root, decision: null }]; // branch lists being filled
    const decisions = [];
    const top = () => stack[stack.length - 1];

    for (const raw of String(script).replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim().replace(/\s+/g, ' ');
        if (!line) continue;
        const first = line.split(' ')[0];
        const kw = RESERVED_WORDS.includes(first) ? first : null;
        const rest = kw ? line.slice(first.length).trim() : line;
        const d = decisions[decisions.length - 1];

        switch (kw) {
            case 'if': case 'if2': {
                const node = { type: 'decision', question: rest, yes: [], no: null };
                top().items.push(node);
                decisions.push(node);
                break;
            }
            case 'then':
                if (d) stack.push({ items: d.yes, decision: d });
                break;
            case 'else':
                if (d) { d.no = d.no || []; stack.push({ items: d.no, decision: d }); }
                break;
            case 'endthen': case 'endelse':
                if (top().decision) stack.pop();
                break;
            case 'endif':
                while (d && top().decision === d) stack.pop();
                decisions.pop();
                break;
            case 'endflow':
                top().items.push({ type: 'end', label: rest });
                break;
            case 'db': {
                const { label, file } = splitFile(rest);
                top().items.push({ type: 'db', label, file });
                break;
            }
            case 'file':
                top().items.push({ type: 'file', label: rest });
                break;
            case 'none': case 'endprocess': case 'pagebreak':
                break;
            default: {
                const { label, file } = splitFile(rest);
                top().items.push({ type: 'process', label, file });
            }
        }
    }
    return root;
}

/**
 * Split a script into pages at top-level "pagebreak <name>" lines, the way the
 * renderer does: breaks inside an if block are ignored, empty pages dropped.
 * Returns [{ name, script }].
 */
export function splitPages(script) {
    const pages = [{ name: '', lines: [], used: false }];
    let depth = 0;
    for (const raw of String(script).replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim().replace(/\s+/g, ' ');
        const first = line.split(' ')[0];
        if (first === 'pagebreak' && depth === 0) {
            pages.push({ name: line.slice(first.length).trim(), lines: [], used: false });
            continue;
        }
        if (first === 'if' || first === 'if2') depth++;
        if (first === 'endif') depth = Math.max(0, depth - 1);
        const cur = pages[pages.length - 1];
        cur.lines.push(raw);
        if (line && first !== 'pagebreak' && first !== 'none' && first !== 'endprocess') cur.used = true;
    }
    return pages.filter((p) => p.used)
        .map((p, k) => ({ name: p.name || `Page ${k + 1}`, script: p.lines.join('\n') }));
}

function splitFile(text) {
    const m = text.match(/^(.*?)\s*<-\s*file\((.*)\)\s*$/);
    return m ? { label: m[1], file: m[2] } : { label: text, file: null };
}

function describe(step) {
    const from = step.file ? ` (input: ${step.file})` : '';
    switch (step.type) {
        case 'end': return step.label ? `End: ${step.label}` : 'End';
        case 'db': return `Database: ${step.label}${from}`;
        case 'file': return `File: ${step.label}`;
        default: return `${step.label}${from}`;
    }
}

/** Render the step tree as a nested Markdown list. */
export function toOutline(steps, indent = '') {
    const out = [];
    steps.forEach((step, i) => {
        const marker = `${i + 1}. `;
        const pad = indent + ' '.repeat(marker.length);
        if (step.type !== 'decision') {
            out.push(`${indent}${marker}${describe(step)}`);
            return;
        }
        out.push(`${indent}${marker}**Decision:** ${step.question || '(no question)'}`);
        for (const [name, branch] of [['Yes', step.yes], ['No', step.no]]) {
            if (!branch || !branch.length) {
                out.push(`${pad}- **${name}:** continue to the next step`);
            } else {
                out.push(`${pad}- **${name}:**`);
                out.push(...toOutline(branch, pad + '  '));
            }
        }
    });
    return out;
}

/**
 * Build the Markdown document.
 * imagePath: path of the PNG relative to the .md file (omit for no image).
 */
export function toMarkdown(script, { title = 'Flowchart', imagePath = null, imagePaths = null } = {}) {
    const src = String(script).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    const fence = src.includes('```') ? '````' : '```';
    const lines = [`# ${title}`, ''];
    const image = (alt, p) => {
        const ref = p.split(path.sep).join('/');
        lines.push(`![${alt}](${/[\s()]/.test(ref) ? `<${ref}>` : ref})`, '');
    };
    const pages = splitPages(src);
    const outlineOf = (s) => {
        const o = toOutline(parseSteps(s));
        return o.length ? o : ['(no steps)'];
    };
    if (pages.length > 1) {
        pages.forEach((pg, i) => {
            lines.push(`## ${pg.name}`, '');
            const img = imagePaths ? imagePaths[i] : null;
            if (img) image(pg.name, img);
            lines.push(...outlineOf(pg.script), '');
        });
    } else {
        const img = imagePath || (imagePaths && imagePaths[0]);
        if (img) image(title, img);
        lines.push('## Steps', '', ...outlineOf(src), '');
    }
    lines.push(
        '## FlowScript source',
        '',
        '<!-- Edit this block and re-render: npx freeflowchart <this file>.md -o <image>.png',
        '     Syntax reference: npx freeflowchart --syntax -->',
        '',
        `${fence}flowscript`, src, fence, '',
    );
    return lines.join('\n');
}

/** Pull the FlowScript block back out of an exported .md file. */
export function extractScript(markdown) {
    const m = String(markdown).match(/^(`{3,})flowscript[^\n]*\n([\s\S]*?)\n\1\s*$/m);
    if (!m) throw new Error('No ```flowscript code block found in the Markdown file');
    return m[2];
}

/** File name for page n of total: "chart.png" for one page, else "chart-1.png", "chart-2.png", … */
export function pageFile(file, n, total) {
    if (total <= 1) return file;
    const ext = path.extname(file);
    return `${file.slice(0, file.length - ext.length)}-${n}${ext}`;
}
