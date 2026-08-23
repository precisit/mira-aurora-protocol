import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import faviconSvg from '../public/favicon.svg?raw';

/**
 * QA console fix: browsers request /favicon.ico by default, which 404'd on
 * the GitHub Pages deployment. An SVG favicon is now shipped from public/
 * and linked from index.html (Vite prefixes the configured base — see
 * vite.config.ts `base: '/mira-aurora-protocol/'` — at dev/build time).
 */

describe('favicon wiring (QA console 404 regression)', () => {
  it('links an SVG favicon from index.html', () => {
    expect(indexHtml).toMatch(/<link\s+rel="icon"[^>]*type="image\/svg\+xml"/i);

    const href = indexHtml.match(/<link\s+rel="icon"[^>]*href="([^"]+)"/i)?.[1];
    expect(href).toBeDefined();
    // Source form is base-relative ("/favicon.svg"); Vite rewrites it to
    // "<base>/favicon.svg" for deployment, so only the tail is asserted.
    expect(href!.endsWith('/favicon.svg')).toBe(true);
  });

  it('ships the linked asset as a valid SVG glyph on a dark backdrop', () => {
    expect(faviconSvg.trimStart().startsWith('<svg')).toBe(true);
    expect(faviconSvg).toContain('</svg>');
    expect(faviconSvg).toContain('#05010f'); // dark backdrop matches theme-color
  });
});
