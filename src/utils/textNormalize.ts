export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u3000]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripQuotedEmail(text: string): string {
  const lines = normalizeText(text).split('\n');
  const quoteStartIndex = lines.findIndex((line) =>
    /^(>+|差出人:|From:|Sent:|送信元:|-----Original Message-----)/i.test(line.trim())
  );
  if (quoteStartIndex >= 0) return lines.slice(0, quoteStartIndex).join('\n').trim();
  return lines.join('\n').trim();
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
