/** Customer-supplied text that is stored or forwarded to people or prompts: one line, no control characters. */
// eslint-disable-next-line no-control-regex
export const plainText = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
