#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { render, FORMATS } from '../lib/render.js';
import { toMarkdown, extractScript } from '../lib/markdown.js';

const USAGE = `Usage: freeflowchart [input.txt | input.md | -] -o <out.png|out.pdf|out.md> [options]
       freeflowchart mcp        Run as an MCP server (stdio) for AI agents

Renders a FlowScript file to PNG or PDF. Reads stdin when input is "-" or omitted.
An input .md file (from a previous md export) is read from its flowscript code block.

Options:
  -o, --output <file>   Output file. Format comes from the extension unless --format is set.
                        Omit to write to stdout (only when stdout is not a terminal).
  -e, --eval <script>   Use this script text instead of a file.
  -f, --format <fmt>    png | pdf | md (default: from --output extension, else png)
                        md writes a Markdown file (image, step outline, FlowScript
                        source) plus the PNG next to it.
  -s, --scale <n>       Pixel ratio, 1-4 (default 2)
  -t, --title <text>    Heading for md output (default: the file name)
  -l, --layout <file>   Also write the layout as JSON: node boxes (with source line
                        numbers), edges and detected issues. Use "-" for stdout.
      --syntax          Print the FlowScript language reference and exit.
  -h, --help            Show this help.`;

function parseArgs(argv) {
    const opts = { input: null, output: null, script: null, format: null, scale: 2, layout: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const val = () => {
            if (i + 1 >= argv.length) fail(`Missing value for ${a}`);
            return argv[++i];
        };
        switch (a) {
            case '-o': case '--output': opts.output = val(); break;
            case '-e': case '--eval': opts.script = val(); break;
            case '-f': case '--format': opts.format = val().toLowerCase(); break;
            case '-s': case '--scale': opts.scale = Number(val()); break;
            case '-l': case '--layout': opts.layout = val(); break;
            case '-t': case '--title': opts.title = val(); break;
            case '--syntax': opts.syntax = true; break;
            case '-h': case '--help': opts.help = true; break;
            default:
                if (a.startsWith('-') && a !== '-') fail(`Unknown option ${a}`);
                if (opts.input) fail('Only one input file is allowed');
                opts.input = a;
        }
    }
    return opts;
}

function fail(msg) {
    process.stderr.write(`freeflowchart: ${msg}\n\n${USAGE}\n`);
    process.exit(2);
}

async function readStdin() {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
}

async function main() {
    // "freeflowchart mcp" runs the MCP server (stdio), so one package covers both.
    if (process.argv[2] === 'mcp') {
        await import('./mcp.js');
        return;
    }
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { process.stdout.write(USAGE + '\n'); return; }
    if (opts.syntax) {
        const spec = new URL('../SPEC.md', import.meta.url);
        process.stdout.write(fs.readFileSync(spec, 'utf8'));
        return;
    }

    let script = opts.script;
    if (script == null) {
        if (opts.input && opts.input !== '-') {
            script = fs.readFileSync(opts.input, 'utf8');
            if (/\.(md|markdown)$/i.test(opts.input)) {
                try { script = extractScript(script); } catch (err) { fail(`${opts.input}: ${err.message}`); }
            }
        }
        else if (process.stdin.isTTY) fail('No input: pass a file, "-" for stdin, or -e "<script>"');
        else script = await readStdin();
    }

    let format = opts.format;
    if (!format && opts.output) format = path.extname(opts.output).slice(1).toLowerCase() || null;
    format = format || 'png';
    if (format === 'markdown') format = 'md';
    if (format === 'md') {
        if (!opts.output || path.extname(opts.output).toLowerCase() !== '.md') fail('md output needs -o <file.md>');
        if (opts.layout === '-') fail('--layout - cannot be combined with md output');
    } else if (!FORMATS.includes(format)) fail(`Unsupported format "${format}" (use png, pdf or md)`);
    if (!(opts.scale >= 1 && opts.scale <= 4)) fail('--scale must be between 1 and 4');
    if (!opts.output && opts.layout === '-') fail('--layout - needs -o <file> for the image');
    if (!opts.output && process.stdout.isTTY) fail('Refusing to write binary to a terminal; pass -o <file>');

    const result = await render(script, { format: format === 'md' ? 'png' : format, scale: opts.scale });
    for (const w of result.warnings) process.stderr.write(`warning: renderer error: ${w}\n`);

    if (format === 'md') {
        const mdPath = path.resolve(opts.output);
        const pngPath = mdPath.replace(/\.md$/i, '.png');
        fs.mkdirSync(path.dirname(mdPath), { recursive: true });
        fs.writeFileSync(pngPath, result.buffer);
        fs.writeFileSync(mdPath, toMarkdown(script, {
            title: opts.title || path.basename(mdPath, path.extname(mdPath)),
            imagePath: path.basename(pngPath),
        }));
        process.stderr.write(`Wrote ${opts.output} and ${path.join(path.dirname(opts.output), path.basename(pngPath))} (${result.width}x${result.height})\n`);
    } else if (opts.output) {
        fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
        fs.writeFileSync(opts.output, result.buffer);
        process.stderr.write(`Wrote ${opts.output} (${result.width}x${result.height}, ${format})\n`);
    } else {
        process.stdout.write(result.buffer);
    }

    if (opts.layout) {
        const json = JSON.stringify(result.layout, null, 2) + '\n';
        if (opts.layout === '-') process.stdout.write(json);
        else {
            fs.writeFileSync(opts.layout, json);
            process.stderr.write(`Wrote ${opts.layout} (${result.layout.nodes.length} nodes, ${result.layout.issues.length} issues)\n`);
        }
    }
}

main().catch((err) => {
    process.stderr.write(`freeflowchart: ${err.message}\n`);
    process.exit(1);
});
