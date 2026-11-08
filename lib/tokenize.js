// Port of getValue() from freeflowchart/main.js — must stay behavior-identical,
// because renderer/chart.js consumes exactly this token stream.

export const RESERVED_WORDS = [
    'if', 'if2', 'else', 'endif', 'endthen', 'endflow', 'none',
    'then', 'endprocess', 'endelse', 'file', 'db',
];

/** Tokens with the 1-based source line each came from. */
export function tokenizeWithLines(script) {
    const src = String(script).replace(/\r\n?/g, '\n').replace(/\n/g, ' <>') + '<>';
    const tokens = [];
    let token = '';
    let line = 1;

    for (const ch of src) {
        if (ch === ' ') {
            const word = token.replace('<>', '').replace(/\s+/g, '');
            if (RESERVED_WORDS.includes(word)) {
                tokens.push({ text: word, line });
                token = '';
            }
        }
        token += ch;
        if (token.includes('<>')) {
            tokens.push({ text: token.replace('<>', ''), line });
            token = '';
            line++;
        }
    }
    return tokens;
}

export function tokenize(script) {
    return tokenizeWithLines(script).map((t) => t.text);
}
