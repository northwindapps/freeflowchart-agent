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
            SPEC,
        inputSchema: {
            script: z.string().min(1).describe('FlowScript source, one statement per line'),
            format: z.enum(['png', 'pdf']).default('png').describe('Output format'),
            output_path: z.string().optional().describe(
                'Absolute file path to save the output to. Required to keep a PDF in a specific place; ' +
                'if omitted for PDF, a temp file path is returned.'),
            scale: z.number().min(1).max(4).default(2).describe('Pixel ratio (resolution multiplier)'),
        },
    },
    async ({ script, format, output_path, scale }) => {
        try {
            const result = await renderer.render(script, { format, scale });
            const content = [];
            let savedTo = null;

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
            for (const w of result.warnings) lines.push(`Renderer warning: ${w}`);
            content.push({ type: 'text', text: lines.join('\n') });
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
