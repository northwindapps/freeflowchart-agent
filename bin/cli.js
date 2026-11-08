#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { render, FORMATS } from '../lib/render.js';

const USAGE = `Usage: freeflowchart [input.txt | -] -o <out.png|out.pdf> [options]

Renders a FlowScript file to PNG or PDF. Reads stdin when input is "-" or omitted.

Options:
  -o, --output <file>   Output file. Format comes from the extension unless --format is set.
                        Omit to write to stdout (only when stdout is not a terminal).
  -e, --eval <script>   Use this script text instead of a file.
  -f, --format <fmt>    png | pdf (default: from --output extension, else png)
  -s, --scale <n>       Pixel ratio, 1-4 (default 2)
      --syntax          Print the FlowScript language reference and exit.
  -h, --help            Show this help.`;

function parseArgs(argv) {
    const opts = { input: null, output: null, script: null, format: null, scale: 2 };
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
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { process.stdout.write(USAGE + '\n'); return; }
    if (opts.syntax) {
        const spec = new URL('../SPEC.md', import.meta.url);
        process.stdout.write(fs.readFileSync(spec, 'utf8'));
        return;
    }

    let script = opts.script;
    if (script == null) {
        if (opts.input && opts.input !== '-') script = fs.readFileSync(opts.input, 'utf8');
        else if (process.stdin.isTTY) fail('No input: pass a file, "-" for stdin, or -e "<script>"');
        else script = await readStdin();
    }

    let format = opts.format;
    if (!format && opts.output) format = path.extname(opts.output).slice(1).toLowerCase() || null;
    format = format || 'png';
    if (!FORMATS.includes(format)) fail(`Unsupported format "${format}" (use png or pdf)`);
    if (!(opts.scale >= 1 && opts.scale <= 4)) fail('--scale must be between 1 and 4');
    if (!opts.output && process.stdout.isTTY) fail('Refusing to write binary to a terminal; pass -o <file>');

    const result = await render(script, { format, scale: opts.scale });
    for (const w of result.warnings) process.stderr.write(`warning: renderer error: ${w}\n`);

    if (opts.output) {
        fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
        fs.writeFileSync(opts.output, result.buffer);
        process.stderr.write(`Wrote ${opts.output} (${result.width}x${result.height}, ${format})\n`);
    } else {
        process.stdout.write(result.buffer);
    }
}

main().catch((err) => {
    process.stderr.write(`freeflowchart: ${err.message}\n`);
    process.exit(1);
});
