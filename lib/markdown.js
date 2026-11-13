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
            case 'none': case 'endprocess':
                break;
            default: {
                const { label, file } = splitFile(rest);
                top().items.push({ type: 'process', label, file });
            }
        }
    }
    return root;
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
export function toMarkdown(script, { title = 'Flowchart', imagePath = null } = {}) {
    const src = String(script).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    const fence = src.includes('```') ? '````' : '```';
    const lines = [`# ${title}`, ''];
    if (imagePath) {
        const ref = imagePath.split(path.sep).join('/');
        lines.push(`![${title}](${/[\s()]/.test(ref) ? `<${ref}>` : ref})`, '');
    }
    const outline = toOutline(parseSteps(src));
    lines.push('## Steps', '', ...(outline.length ? outline : ['(no steps)']), '');
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
