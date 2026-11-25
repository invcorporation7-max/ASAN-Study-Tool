import sanitizeHtml from 'sanitize-html';

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

const SAFE_COLOR_REGEX = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[0-9.]+\s*\)|[a-zA-Z]{3,24})$/;
const SAFE_FONT_SIZE_REGEX = /^(\d{1,2}(\.\d+)?(px|rem|em|%)|xx-small|x-small|small|medium|large|x-large|xx-large)$/;
const SAFE_FONT_FAMILY_REGEX = /^[a-zA-Z0-9\s,'"-]{1,80}$/;

export function sanitizeRichHtmlServer(dirtyHtml: string): string {
  const input = String(dirtyHtml || '').slice(0, 60000);
  if (!input.trim()) return '';
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'style'],
      th: ['colspan', 'rowspan', 'style'],
      td: ['colspan', 'rowspan', 'style'],
      table: ['style'],
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        color: [SAFE_COLOR_REGEX],
        'background-color': [SAFE_COLOR_REGEX],
        'font-family': [SAFE_FONT_FAMILY_REGEX],
        'font-size': [SAFE_FONT_SIZE_REGEX],
        'text-align': [/^(left|center|right|justify)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'text-decoration': [/^(none|underline|line-through)$/],
        width: [/^\d{1,4}(px|%)$/],
        'max-width': [/^\d{1,4}(px|%)$/],
      },
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
      a: ['http', 'https', 'mailto'],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      }),
    },
  }).trim();
}

export function richHtmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
