#!/usr/bin/env node
// MCP server (stdio) exposing FlowScript rendering as a tool.
// stdout is the protocol channel: log only to stderr.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRenderer } from '../lib/render.js';
import { toMarkdown, pageFile } from '../lib/markdown.js';
import { checkOutputPath } from '../lib/safepath.js';

const SPEC = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const renderer = createRenderer();

const server = new McpServer({ name: 'freeflowchart', version: pkg.version });

server.registerTool(
    'render_flowchart',
    {
        title: 'Render flowchart',
        description:
            'Render a FlowScript flowchart to PNG or PDF. PNG output is returned as an image so you can ' +
            'check the result; PDF is saved to a file. Pass output_path to save either format to disk.\n\n' +
            'The result also includes a JSON layout: every node with its box (x, y, width, height in CSS px ' +
            'from the image top-left; multiply by scale for image pixels), the script line it came from, ' +
            'the edges, and detected issues ("overlap", "edge_crosses_node") with the script lines involved. ' +
            'Use the issues to revise the script and render again.\n\n' +
            'Pass markdown_path to also save a Markdown file documenting the chart: the PNG image, a ' +
            'step-by-step outline of the flow, and the FlowScript source (so it can be edited and ' +
            're-rendered later). The PNG is saved next to it unless output_path is a .png.\n\n' +
            'Scripts with several pages ("pagebreak <name>" lines) render one image per page; files are ' +
            'saved as name-1.png, name-2.png, …, a PDF gets one page per chart page, and the Markdown ' +
            'gets one section per page. The layout then has a "pages" array.\n\n' +
            'Saved files must end in .png, .pdf or .md (matching the format), cannot be in hidden or system ' +
            'folders, and an existing file is only replaced if freeflowchart created it.\n\n' +
            SPEC,
        inputSchema: {
            script: z.string().min(1).describe('FlowScript source, one statement per line'),
            format: z.enum(['png', 'pdf']).default('png').describe('Output format'),
            output_path: z.string().optional().describe(
                'Absolute file path to save the output to. Required to keep a PDF in a specific place; ' +
                'if omitted for PDF, a temp file path is returned.'),
            scale: z.number().min(1).max(4).default(2).describe('Pixel ratio (resolution multiplier)'),
            include_layout: z.boolean().default(true).describe('Include the JSON layout in the result'),
            markdown_path: z.string().optional().describe(
                'Absolute path of a .md file to write: image, step outline and FlowScript source.'),
            title: z.string().optional().describe('Heading for the Markdown file (default: its file name)'),
        },
    },
    async ({ script, format, output_path, scale, include_layout, markdown_path, title }) => {
        try {
            const result = await renderer.render(script, { format, scale });
            const pages = result.pages;
            const n = pages.length;

            // Work out and validate every target before writing anything.
            const writes = []; // [absPath, buffer|string, label]
            let outPath = output_path ? checkOutputPath(output_path, format) : null;
            if (!outPath && format === 'pdf') outPath = path.join(os.tmpdir(), `flowchart-${Date.now()}.pdf`);
            if (outPath && format === 'pdf') writes.push([outPath, result.buffer, `PDF (${n} page${n > 1 ? 's' : ''})`]);
            let pngPaths = null;
            if (outPath && format === 'png') {
                pngPaths = pages.map((_, i) => checkOutputPath(pageFile(outPath, i + 1, n), 'png'));
            }
            if (markdown_path) {
                const mdPath = checkOutputPath(markdown_path, 'md');
                if (!pngPaths) {
                    const base = mdPath.replace(/\.(md|markdown)$/i, '') + '.png';
                    pngPaths = pages.map((_, i) => checkOutputPath(pageFile(base, i + 1, n), 'png'));
                }
                const md = toMarkdown(script, {
                    title: title || path.basename(mdPath).replace(/\.(md|markdown)$/i, ''),
                    imagePaths: pngPaths.map((p) => path.relative(path.dirname(mdPath), p)),
                });
                writes.push([mdPath, md, 'Markdown']);
            }
            if (pngPaths) pages.forEach((pg, i) => writes.push([pngPaths[i], pg.buffer, n > 1 ? `PNG page ${i + 1}` : 'PNG']));

            for (const [file, data] of writes) {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, data);
            }

            const content = [];
            const lines = [`Rendered ${n} page${n > 1 ? 's' : ''} as ${format.toUpperCase()} at ${scale}x.`];
            for (const [file, , label] of writes) lines.push(`Saved ${label} to ${file}`);
            let issues = 0;
            for (const pg of pages) {
                for (const w of pg.warnings) lines.push(`Renderer warning (page ${pg.page}): ${w}`);
                issues += pg.layout.issues.length;
            }
            lines.push(issues ? `${issues} layout issue(s) detected; see "issues" in the layout.` : 'No layout issues detected.');
            content.push({ type: 'text', text: lines.join('\n') });

            if (format === 'png') {
                for (const pg of pages) {
                    if (n > 1) content.push({ type: 'text', text: `Page ${pg.page}: ${pg.name} (${pg.width}x${pg.height} CSS px)` });
                    content.push({ type: 'image', data: pg.buffer.toString('base64'), mimeType: 'image/png' });
                }
            }
            if (include_layout) {
                const layout = n > 1
                    ? { pages: pages.map((pg) => ({ page: pg.page, name: pg.name, ...pg.layout })) }
                    : result.layout;
                content.push({ type: 'text', text: JSON.stringify(layout) });
            }
            return { content };
        } catch (err) {
            return { isError: true, content: [{ type: 'text', text: `Failed: ${err.message}` }] };
        }
    },
);

async function shutdown() {
    await renderer.close().catch(() => {});
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

await server.connect(new StdioServerTransport());
console.error('freeflowchart MCP server running on stdio');
