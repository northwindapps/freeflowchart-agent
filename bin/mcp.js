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
import { toMarkdown } from '../lib/markdown.js';

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
            const content = [];
            let savedTo = null;
            const extraLines = [];

            if (markdown_path) {
                const mdPath = path.resolve(markdown_path);
                const pngPath = format === 'png' && output_path
                    ? path.resolve(output_path)
                    : mdPath.replace(/\.(md|markdown)$/i, '') + '.png';
                const png = format === 'png' ? result : await renderer.render(script, { format: 'png', scale });
                fs.mkdirSync(path.dirname(pngPath), { recursive: true });
                fs.writeFileSync(pngPath, png.buffer);
                const md = toMarkdown(script, {
                    title: title || path.basename(mdPath).replace(/\.(md|markdown)$/i, ''),
                    imagePath: path.relative(path.dirname(mdPath), pngPath),
                });
                fs.mkdirSync(path.dirname(mdPath), { recursive: true });
                fs.writeFileSync(mdPath, md);
                extraLines.push(`Saved Markdown to ${mdPath}`, `Saved PNG to ${pngPath}`);
            }

            if (output_path || format === 'pdf') {
                savedTo = output_path
                    ? path.resolve(output_path)
                    : path.join(os.tmpdir(), `flowchart-${Date.now()}.pdf`);
                fs.mkdirSync(path.dirname(savedTo), { recursive: true });
                fs.writeFileSync(savedTo, result.buffer);
            }
            if (format === 'png') {
                content.push({ type: 'image', data: result.buffer.toString('base64'), mimeType: 'image/png' });
            }

            const lines = [`Rendered ${format.toUpperCase()}, ${result.width}x${result.height} CSS px at ${scale}x.`];
            if (savedTo) lines.push(`Saved to ${savedTo}`);
            lines.push(...extraLines.filter((l) => !(savedTo && l.endsWith(savedTo))));
            for (const w of result.warnings) lines.push(`Renderer warning: ${w}`);
            const issues = result.layout.issues.length;
            lines.push(issues ? `${issues} layout issue(s) detected; see "issues" in the layout.` : 'No layout issues detected.');
            content.push({ type: 'text', text: lines.join('\n') });
            if (include_layout) {
                content.push({ type: 'text', text: JSON.stringify(result.layout) });
            }
            return { content };
        } catch (err) {
            return { isError: true, content: [{ type: 'text', text: `Render failed: ${err.message}` }] };
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
