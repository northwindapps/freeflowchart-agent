import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
    Browser, computeExecutablePath, detectBrowserPlatform, getInstalledBrowsers, install, resolveBuildId,
} from '@puppeteer/browsers';
import { tokenizeWithLines } from './tokenize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDER_URL = pathToFileURL(path.join(here, '..', 'renderer', 'render.html')).href;

export const FORMATS = ['png', 'pdf'];

/**
 * A renderer holds one headless Chrome and renders many scripts.
 * Call close() when done.
 */
export function createRenderer({ launchOptions = {} } = {}) {
    let browserPromise = null;

    function browser() {
        if (!browserPromise) {
            browserPromise = launch(launchOptions);
            browserPromise.catch(() => { browserPromise = null; });
        }
        return browserPromise;
    }

    async function render(script, { format = 'png', scale = 2, padding = 30 } = {}) {
        if (!FORMATS.includes(format)) throw new Error(`Unsupported format "${format}" (use png or pdf)`);
        if (!String(script).trim()) throw new Error('Script is empty');

        const tokens = tokenizeWithLines(script);
        const png = await renderPNG(await browser(), tokens, scale, padding);
        if (format === 'png') return png;
        return { ...png, buffer: await pngToPDF(await browser(), png) };
    }

    async function close() {
        if (browserPromise) {
            const b = await browserPromise;
            browserPromise = null;
            await b.close();
        }
    }

    return { render, close };
}

// Where a downloaded headless Chrome is kept (shared by all runs).
const CACHE_DIR = process.env.FREEFLOWCHART_CACHE_DIR ||
    path.join(os.homedir(), '.cache', 'freeflowchart');

// Find a Chrome to render with, in this order:
//   1. launchOptions.executablePath or PUPPETEER_EXECUTABLE_PATH
//   2. an installed Google Chrome
//   3. a headless Chrome previously downloaded into CACHE_DIR
//   4. download headless Chrome into CACHE_DIR (first run only)
// No install-time download, so `npx freeflowchart` works without install scripts.
async function launch(launchOptions) {
    const explicit = launchOptions.executablePath || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (explicit) return puppeteer.launch({ headless: true, ...launchOptions, executablePath: explicit });

    const errors = [];
    try {
        return await puppeteer.launch({ headless: true, channel: 'chrome', ...launchOptions });
    } catch (err) {
        errors.push(`installed Chrome: ${firstLine(err)}`);
    }

    try {
        const executablePath = await headlessShell();
        return await puppeteer.launch({ headless: 'shell', ...launchOptions, executablePath });
    } catch (err) {
        errors.push(`downloaded Chrome: ${firstLine(err)}`);
    }

    throw new Error(
        'Could not start Chrome. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH.\n  ' + errors.join('\n  '));
}

async function headlessShell() {
    const browser = Browser.CHROMEHEADLESSSHELL;
    const installed = (await getInstalledBrowsers({ cacheDir: CACHE_DIR })).filter((b) => b.browser === browser);
    if (installed.length) return installed[installed.length - 1].executablePath;

    const platform = detectBrowserPlatform();
    if (!platform) throw new Error(`unsupported platform ${process.platform}/${process.arch}`);
    const buildId = await resolveBuildId(browser, platform, 'stable');
    process.stderr.write(`freeflowchart: downloading headless Chrome ${buildId} to ${CACHE_DIR} (first run only)...\n`);
    await install({ browser, buildId, cacheDir: CACHE_DIR, platform });
    return computeExecutablePath({ browser, buildId, cacheDir: CACHE_DIR, platform });
}

function firstLine(err) {
    return String(err && err.message || err).split('\n')[0];
}

/** One-shot convenience: launch, render, close. */
export async function render(script, options) {
    const r = createRenderer();
    try {
        return await r.render(script, options);
    } finally {
        await r.close();
    }
}

async function renderPNG(browser, lineTokens, scale, padding) {
    const tokens = lineTokens.map((t) => t.text);
    // chart.js drops blank tokens and uses the remaining index as each node's id.
    const lineOfId = lineTokens.filter((t) => t.text.replace(/\s/g, '')).map((t) => t.line);
    const page = await browser.newPage();
    const pageErrors = [];
    try {
        page.on('pageerror', (e) => pageErrors.push(e.message));

        // Fully offline: only the bundled renderer files may load.
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            if (url.startsWith('file:') || url.startsWith('data:')) req.continue();
            else req.abort();
        });

        // chart.js reads its tokens from sessionStorage, as the web app does.
        await page.evaluateOnNewDocument((t) => {
            sessionStorage.setItem('src', JSON.stringify(t));
        }, tokens);

        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: scale });
        await page.goto(RENDER_URL, { waitUntil: 'load' });
        await nextFrames(page);

        // Some nodes (e.g. files attached with "<- file(...)") are drawn above the
        // page origin. Push the chart down/right until everything is on the page.
        let b = await measure(page);
        if (b && (b.l < padding || b.t < padding)) {
            await page.evaluate((dx, dy) => {
                const wrap = document.querySelector('.foo');
                const cs = getComputedStyle(wrap);
                wrap.style.marginLeft = parseFloat(cs.marginLeft) + dx + 'px';
                wrap.style.marginTop = parseFloat(cs.marginTop) + dy + 'px';
            }, Math.max(0, Math.ceil(padding - b.l)), Math.max(0, Math.ceil(padding - b.t)));
        }

        // Grow the viewport to the whole chart: connection lines live in a
        // position:fixed SVG, so anything outside the viewport would be lost.
        const size = await page.evaluate(() => ({
            w: document.documentElement.scrollWidth,
            h: document.documentElement.scrollHeight,
        }));
        await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: scale });
        await nextFrames(page);

        b = await measure(page);
        const box = b && (() => {
            const x = Math.max(0, Math.floor(b.l - padding));
            const y = Math.max(0, Math.floor(b.t - padding));
            return { x, y, width: Math.ceil(b.r + padding) - x, height: Math.ceil(b.btm + padding) - y };
        })();

        if (!box) {
            const why = pageErrors.length ? ` (renderer error: ${pageErrors.join('; ')})` : '';
            throw new Error('Script produced an empty chart' + why);
        }

        const layout = await extractLayout(page, box, lineOfId);
        const buffer = await page.screenshot({ type: 'png', clip: box });
        return { buffer: Buffer.from(buffer), width: box.width, height: box.height, layout, warnings: pageErrors };
    } finally {
        await page.close();
    }
}

async function pngToPDF(browser, png) {
    const page = await browser.newPage();
    try {
        const { width, height } = png;
        await page.setContent(
            `<style>html,body{margin:0;padding:0}img{display:block;width:${width}px;height:${height}px}</style>` +
            `<img src="data:image/png;base64,${png.buffer.toString('base64')}">`,
            { waitUntil: 'load' },
        );
        const pdf = await page.pdf({
            width: `${width}px`,
            height: `${height}px`,
            printBackground: true,
            pageRanges: '1',
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        return Buffer.from(pdf);
    } finally {
        await page.close();
    }
}

/**
 * Node boxes, edges and detected layout problems, in CSS px relative to the
 * top-left of the output image (multiply by `scale` for image pixels).
 */
async function extractLayout(page, box, lineOfId) {
    const raw = await page.evaluate((ox, oy) => {
        const rel = (r) => ({
            x: Math.round(r.left - ox), y: Math.round(r.top - oy),
            width: Math.round(r.right - r.left), height: Math.round(r.bottom - r.top),
        });
        const nodes = [];
        document.querySelectorAll('#main > li[id]').forEach((li) => {
            let type, label = '', url, el, r;
            const q = (sel) => li.querySelector(sel);
            if (li.classList.contains('d')) {
                type = 'decision';
                label = q('.d-body')?.textContent ?? '';
                const lr = li.getBoundingClientRect(), sc = lr.height / 320;
                r = { left: lr.left, right: lr.right, top: lr.top + 85 * sc, bottom: lr.top + 216 * sc };
            } else if ((el = q('.endflow'))) {
                type = 'end';
                label = q('.endflow-label')?.value ?? '';
            } else if ((el = q('.proc-db'))) {
                type = 'database';
                label = q('.proc-db-label')?.textContent ?? '';
            } else if ((el = q('.proc-file'))) {
                type = 'file';
                label = q('.proc-file-label')?.textContent ?? '';
            } else if ((el = q('.proc-doc'))) {
                type = 'process';
                label = q('.proc-doc-label')?.textContent ?? '';
                url = q('.proc-doc-url')?.value || undefined;
            } else if ((el = q('p.process'))) {
                type = 'process';
                label = el.textContent;
            } else {
                return;
            }
            r = r || el.getBoundingClientRect();
            nodes.push({ id: li.id, type, label: label.trim(), url, ...rel(r), _abs: { l: r.left, t: r.top, r: r.right, b: r.bottom } });
        });

        const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
        const conns = window._getConnections ? window._getConnections() : [];
        const edges = [];
        const crossings = [];
        conns.forEach((c) => {
            const from = c.from.closest('li')?.id, to = c.to.closest('li')?.id;
            if (!byId[from] || !byId[to]) return;
            edges.push({ from, to, fromSide: c.fromSide, toSide: c.toSide });

            // Sample the drawn curve; flag nodes it passes through (other than its ends).
            const len = c.path.getTotalLength();
            const hit = new Set();
            for (let d = 0; d <= len; d += 4) {
                const p = c.path.getPointAtLength(d);
                for (const n of nodes) {
                    if (n.id === from || n.id === to || hit.has(n.id)) continue;
                    const a = n._abs, m = 3;
                    if (p.x > a.l + m && p.x < a.r - m && p.y > a.t + m && p.y < a.b - m) hit.add(n.id);
                }
            }
            hit.forEach((id) => crossings.push({ from, to, node: id }));
        });
        return { nodes, edges, crossings };
    }, box.x, box.y);

    const lineOf = (id) => {
        const m = /^(__f)?(\d+)$/.exec(id);
        return m ? lineOfId[Number(m[2])] : undefined;
    };
    const nodes = raw.nodes.map(({ _abs, ...n }) => ({
        ...n,
        line: lineOf(n.id),
        ...(n.id.startsWith('__f') ? { attachedTo: n.id.slice(3) } : {}),
    }));

    const issues = [];
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            if (ox > 2 && oy > 2) issues.push({ type: 'overlap', nodes: [a.id, b.id], lines: [a.line, b.line] });
        }
    }
    for (const c of raw.crossings) {
        issues.push({
            type: 'edge_crosses_node', edge: { from: c.from, to: c.to }, node: c.node,
            lines: [lineOf(c.from), lineOf(c.to), lineOf(c.node)],
        });
    }

    return { width: box.width, height: box.height, units: 'css-px', nodes, edges: raw.edges, issues };
}

// Bounding box (client coords) of everything drawn: leaf nodes and connection lines.
function measure(page) {
    return page.evaluate(() => {
        const b = { l: Infinity, t: Infinity, r: -Infinity, btm: -Infinity };
        const add = (l, t, r, btm) => {
            if (r - l <= 0 || btm - t <= 0) return;
            b.l = Math.min(b.l, l); b.t = Math.min(b.t, t);
            b.r = Math.max(b.r, r); b.btm = Math.max(b.btm, btm);
        };
        // Skip invisible wrappers (lane rows are taller than what they draw):
        // measure leaves plus anything that paints a border or background.
        const paints = (el) => {
            const cs = getComputedStyle(el);
            return ['Top', 'Right', 'Bottom', 'Left'].some((s) =>
                    parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none') ||
                (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
                cs.backgroundImage !== 'none' || cs.boxShadow !== 'none';
        };
        document.querySelectorAll('#main *').forEach((el) => {
            const r = el.getBoundingClientRect();
            const diamond = el.closest('li.d');
            if (diamond) {
                // Diamonds are CSS border triangles with wide transparent borders. Use the
                // drawn shape (same geometry as connect.js edgePt) plus any label text.
                if (el === diamond) {
                    const sc = r.height / 320;
                    add(r.left, r.top + 80 * sc, r.right, r.top + 220 * sc);
                } else if (!el.children.length && el.textContent.trim()) {
                    add(r.left, r.top, r.right, r.bottom);
                }
                return;
            }
            if (el.children.length && !paints(el)) return;
            add(r.left, r.top, r.right, r.bottom);
        });
        document.querySelectorAll('#conn-svg path').forEach((p) => {
            const bb = p.getBBox();
            add(bb.x, bb.y, bb.x + bb.width, bb.y + bb.height);
        });
        return isFinite(b.l) ? b : null;
    });
}

function nextFrames(page) {
    // connect.js updates line positions on requestAnimationFrame
    return page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
}
