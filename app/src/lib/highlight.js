// Thin wrapper around highlight.js's core (only the languages this tool
// actually needs are registered, to keep the singlefile bundle small).
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bash);

// CodeGraph's `files.language` values -> hljs registered language names.
// hljs has no dedicated tsx/jsx grammar; its javascript/typescript grammars
// already tokenize JSX well enough for syntax coloring purposes.
const LANG_ALIAS = {
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript',
  python: 'python', py: 'python',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  markdown: 'markdown', md: 'markdown',
  css: 'css', scss: 'css',
  html: 'xml', xml: 'xml',
  bash: 'bash', shell: 'bash', sh: 'bash',
};

/** Maps a CodeGraph `files.language` value to its registered highlight.js language name, if supported. */
export function hljsLang(language) {
  return LANG_ALIAS[language] || null;
}

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapes HTML-sensitive characters so raw text can be safely rendered as innerHTML. */
function escapeHtml(s) {
  return s.replace(ESCAPE_RE, (c) => ESCAPE_MAP[c]);
}

// Highlights one line of code in isolation — no cross-line grammar state,
// so a multi-line string/comment won't be colored consistently across the
// lines it spans. That's a deliberate simplification: we render each line
// as its own DOM node (for the line-number gutter and per-line highlight
// background), and splitting highlight.js's own multi-line HTML output
// across line boundaries would leave dangling/duplicated tags. Good enough
// for at-a-glance coloring; falls back to escaped plain text for unknown
// languages.
export function highlightLine(text, language) {
  const lang = hljsLang(language);
  if (!lang) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

// Highlights a full multi-line snippet as one block (unlike highlightLine,
// preserves hljs's cross-line grammar state — correct coloring for
// constructs spanning lines, e.g. multi-line strings/comments). Use this
// whenever the snippet is rendered as a single <pre>/{@html} block rather
// than split into per-line DOM nodes.
export function highlightBlock(text, language) {
  const lang = hljsLang(language);
  if (!lang) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}
