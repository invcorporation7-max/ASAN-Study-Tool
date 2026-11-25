import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'span',
  'div',
  'hr',
];

const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'width',
  'height',
  'style',
  'colspan',
  'rowspan',
];

export function sanitizeRichHtmlClient(dirtyHtml: string): string {
  const input = String(dirtyHtml || '').slice(0, 60000);
  if (!input.trim()) return '';
  const clean = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/api\/forum\/attachments\/)/i,
  });

  if (typeof document === 'undefined') return clean;
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  tpl.content.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href') || '';
    if (!/^(https?:\/\/|mailto:)/i.test(href)) {
      anchor.removeAttribute('href');
    } else {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  return tpl.innerHTML;
}

export function clientHtmlToPlainText(html: string): string {
  if (typeof document === 'undefined') {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const div = document.createElement('div');
  div.innerHTML = sanitizeRichHtmlClient(html);
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}
