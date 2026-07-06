import DOMPurify from 'dompurify';
import { marked, Renderer } from 'marked';

const STREAMING_MARKDOWN_ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
] as const;

const STREAMING_MARKDOWN_ALLOWED_ATTR = [
  'class',
  'href',
  'rel',
  'title',
] as const;

const SAFE_LINK_URI_PATTERN = /^(?:(?:https?|mailto):|[^:]+$)/i;

function isSafeLinkUri(uri: string): boolean {
  return SAFE_LINK_URI_PATTERN.test(uri.trim());
}

function createStreamingMarkdownRenderer(): Renderer {
  const renderer = new Renderer();
  const renderLink = renderer.link.bind(renderer);

  // LLM output is untrusted. Markdown formatting is allowed, raw HTML is not.
  renderer.html = () => '';
  renderer.image = () => '';
  renderer.link = (token) => {
    if (!isSafeLinkUri(token.href)) {
      return renderer.parser.parseInline(token.tokens) as string;
    }

    return renderLink(token);
  };

  return renderer;
}

export function renderSafeStreamingMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown, {
    async: false,
    renderer: createStreamingMarkdownRenderer(),
  }) as string;

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_ATTR: [...STREAMING_MARKDOWN_ALLOWED_ATTR],
    ALLOWED_TAGS: [...STREAMING_MARKDOWN_ALLOWED_TAGS],
    ALLOWED_URI_REGEXP: SAFE_LINK_URI_PATTERN,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style'],
    FORBID_TAGS: [
      'button',
      'embed',
      'form',
      'iframe',
      'img',
      'input',
      'math',
      'object',
      'script',
      'select',
      'style',
      'svg',
      'template',
      'textarea',
    ],
  });
}
