import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import { tokenize } from './tokenize.js';

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

        const png = await renderPNG(await browser(), tokenize(script), scale, padding);
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

// Prefer Puppeteer's own Chrome (or PUPPETEER_EXECUTABLE_PATH); fall back to the
// system-installed Google Chrome when that download was skipped.
async function launch(launchOptions) {
    try {
        return await puppeteer.launch({ headless: true, ...launchOptions });
    } catch (err) {
        if (launchOptions.executablePath || launchOptions.channel) throw err;
        try {
            return await puppeteer.launch({ headless: true, channel: 'chrome', ...launchOptions });
        } catch {
            throw new Error(
                `Could not start Chrome. Install Google Chrome, run "npx puppeteer browsers install chrome", ` +
                `or set PUPPETEER_EXECUTABLE_PATH. (${err.message.split('\n')[0]})`);
        }
    }
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

async function renderPNG(browser, tokens, scale, padding) {
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

        const buffer = await page.screenshot({ type: 'png', clip: box });
        return { buffer: Buffer.from(buffer), width: box.width, height: box.height, warnings: pageErrors };
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
