// Port of getValue() from freeflowchart/main.js — must stay behavior-identical,
// because renderer/chart.js consumes exactly this token stream.

export const RESERVED_WORDS = [
    'if', 'if2', 'else', 'endif', 'endthen', 'endflow', 'none',
    'then', 'endprocess', 'endelse', 'file', 'db',
];

export function tokenize(script) {
    const src = String(script).replace(/\r\n?/g, '\n').replace(/\n/g, ' <>') + '<>';
    const tokens = [];
    let token = '';

    for (const ch of src) {
        if (ch === ' ') {
            const word = token.replace('<>', '').replace(/\s+/g, '');
            if (RESERVED_WORDS.includes(word)) {
                tokens.push(word);
                token = '';
            }
        }
        token += ch;
        if (token.includes('<>')) {
            tokens.push(token.replace('<>', ''));
            token = '';
        }
    }
    return tokens;
}
