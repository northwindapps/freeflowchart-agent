# freeflowchart

Turn plain text into a flowchart image. Write steps and decisions in
[FlowScript](https://freeflowchart.web.app), a tiny line-based language, and get
a PNG or PDF back. It works from the command line and as an MCP server, so AI
agents (Claude Code, Claude Desktop, Cursor, …) can draw flowcharts and check
the result. Rendering runs locally in headless Chrome, with no network calls.

```
start
if member?
  then
    apply discount
  endthen
else
    regular price
  endelse
endif
endflow done
```

Try the same language interactively at <https://freeflowchart.web.app>.

## Requirements

Node.js 18 or later. Chrome is downloaded by Puppeteer on install. If that
download is skipped, an installed Google Chrome is used instead (or run
`npx puppeteer browsers install chrome`, or set `PUPPETEER_EXECUTABLE_PATH`).

## Use with AI agents (MCP)

Claude Code:

```sh
claude mcp add freeflowchart -- npx -y freeflowchart mcp
```

Claude Desktop, Cursor and other clients (`mcpServers` config):

```json
{
  "mcpServers": {
    "freeflowchart": {
      "command": "npx",
      "args": ["-y", "freeflowchart", "mcp"]
    }
  }
}
```

The agent learns the language from the tool description, so no setup or
prompting is needed. Just ask it to draw a flowchart.

## Command line

```sh
npx freeflowchart chart.txt -o chart.png          # format from extension
npx freeflowchart chart.txt -o chart.pdf
cat chart.txt | npx freeflowchart -o chart.png    # stdin
npx freeflowchart -e "start
endflow" -o out.png                               # inline script
npx freeflowchart --syntax                        # print the language reference
```

Options: `-f png|pdf`, `-s <scale 1-4>` (pixel ratio, default 2),
`-l <file.json|->` (also write the layout, see below). Without `-o`,
the image is written to stdout when stdout is piped.

## MCP tool

The server exposes one tool, `render_flowchart`:

| Argument | Type | Default | Notes |
|---|---|---|---|
| `script` | string | (required) | FlowScript source |
| `format` | `png` \| `pdf` | `png` | |
| `output_path` | string | none | Absolute path to save the file |
| `scale` | 1–4 | 2 | Resolution multiplier |
| `include_layout` | boolean | `true` | Include the JSON layout (see below) |

PNG results come back as an image the agent can look at. PDFs are saved to
`output_path`, or to a temp file whose path is returned. The full language
reference (`npx freeflowchart --syntax`) is in the tool description, so agents can write
valid scripts without extra setup.

## Layout output

Every render also produces a layout. The MCP tool returns it alongside the
image, and the CLI writes it with `--layout`:

```json
{
  "width": 880, "height": 940, "units": "css-px",
  "nodes": [
    { "id": "0", "type": "decision", "label": "member?", "x": 100, "y": 35, "width": 220, "height": 131, "line": 1 },
    { "id": "3", "type": "process", "label": "apply discount", "x": 100, "y": 350, "width": 220, "height": 140, "line": 3 },
    { "id": "__f7", "type": "file", "label": "orders.csv", "x": 420, "y": 590, "width": 220, "height": 140, "line": 7, "attachedTo": "7" }
  ],
  "edges": [ { "from": "0", "to": "3", "fromSide": "bottom", "toSide": "top" } ],
  "issues": [
    { "type": "edge_crosses_node", "edge": { "from": "0", "to": "6" }, "node": "3", "lines": [1, 6, 3] }
  ]
}
```

- Coordinates are CSS px from the image's top-left. Multiply by `scale` to get image pixels.
- `type` is one of `process`, `decision`, `end`, `database` or `file`.
- `line` is the 1-based script line that produced the node, so an agent knows which line to edit.
- `issues` lists detected problems: `overlap` (two node boxes intersect) and
  `edge_crosses_node` (a connection line passes through a node it doesn't connect).

## Library

```js
import { render, createRenderer } from 'freeflowchart';

const { buffer, width, height } = await render(script, { format: 'png', scale: 2 });

// Many renders: reuse one Chrome
const r = createRenderer();
await r.render(a); await r.render(b);
await r.close();
```

## Development (from source)

### Updating the renderer

`renderer/` is a copy of `chart.js`, `connect.js` and `style.css` from the
freeflowchart web app. `renderer/SOURCE_COMMIT` records which commit it came from.
After changing the web app, run:

```sh
npm run sync-renderer            # expects ../freeflowchart; or pass a path
npm test
```

`lib/tokenize.js` is a port of `getValue()` in the web app's `main.js`. The tests
check that it matches the original whenever `../freeflowchart` is present.

### Tests

```sh
npm test
```
