# FlowScript language reference

FlowScript is a line-based text format that renders to a left-to-right flowchart.

## Rules

- **One statement per line.** Indentation and blank lines are ignored; indent only for readability.
- A line is either a **keyword line** or a **process line** (any other text becomes a box).
- Keywords are lowercase and must be the **first word** on the line.
- **Gotcha:** a process label must not start with a keyword word. `none of the above` is read as
  the `none` keyword followed by a box labelled `of the above`. Reword it (`No match`) or
  capitalize it (`None of the above`), since keywords are case-sensitive.
- Every `if`/`if2` needs a `then … endthen` block and a closing `endif`.
  `if` may also have one `else … endelse` block between `endthen` and `endif`.

## Keywords

| Line | Renders |
|---|---|
| `<text>` | Process box labelled `<text>` |
| `<text> (<url>)` | Process box with `<url>` shown in its footer |
| `<text> <- file(<name>)` | Process box with a document node `<name>` above it, connected down to it |
| `if <question>` | Decision diamond. Use with `then`/`endthen`, optional `else`/`endelse`, then `endif` |
| `if2 <question>` | Decision diamond with no `else`; the "no" path continues to the next node after `endif` |
| `then` / `endthen` | Start / end the "yes" branch (drawn downward) |
| `else` / `endelse` | Start / end the "no" branch |
| `endif` | Close the if block; the flow continues to the right |
| `endflow` | Terminator circle |
| `endflow <text>` | Terminator circle with `<text>` beneath it |
| `db <name>` | Database cylinder |
| `db <name> <- file(<source>)` | Database cylinder with a document node `<source>` above it |
| `file <name>` | Standalone document node |
| `none` | Spacer: no node. Use it to leave a branch empty |
| `endprocess` | No-op marker (accepted for compatibility) |

## Multiple flows in one chart

When every branch of an `if/else` ends in `endflow`, the next top-level line starts a new
flow below the previous one. A plain text line before it works as that flow's title box.

## Examples

Linear:
```
start
db Product Catalog <- file(products.xlsx)
select item
checkout
endflow done
```

If / else:
```
if member?
  then
    apply discount
    endflow discount applied
  endthen
else
    regular price
    endflow no discount
  endelse
endif
```

Chained `if2` (no else):
```
if2 member?
  then
    apply discount
  endthen
endif
if2 coupon?
  then
    apply coupon
  endthen
endif
process payment
endflow
```

Two flows in one chart:
```
Order Flow
if member?
  then
    apply discount
    endflow discount applied
  endthen
else
    regular price
    endflow no discount
  endelse
endif
Payment Flow
charge card
endflow payment done
```
