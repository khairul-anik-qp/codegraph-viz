// Pure DOM helpers for exporting a live <svg> element (FlowView's flow
// diagram) to a downloadable image. No dependencies — canvas + XMLSerializer
// only, so this works entirely offline like the rest of the static viewer.

// The custom properties FlowView's D3 code references via var(--x) in fill/
// stroke attributes. Resolved to concrete colors before serializing so the
// exported file renders correctly outside the page's own stylesheet context.
const CSS_VARS = ['--accent', '--accent-soft', '--surface', '--border', '--text', '--muted', '--calls'];

/** Reads the current computed values of the theme's CSS custom properties off `svgEl`. */
function resolveCssVars(svgEl) {
  const computed = getComputedStyle(svgEl);
  const map = {};
  for (const name of CSS_VARS) map[name] = computed.getPropertyValue(name).trim();
  return map;
}

// Returns a standalone SVG string with every var(--x) reference in a fill/
// stroke attribute replaced by its resolved color, and the package-color
// palette (already concrete hex values from PKG_COLORS) left untouched.
export function svgToSvgString(svgEl) {
  const clone = svgEl.cloneNode(true);
  const vars = resolveCssVars(svgEl);
  const varPattern = /var\((--[a-z-]+)\)/g;
  for (const el of clone.querySelectorAll('[fill],[stroke]')) {
    for (const attr of ['fill', 'stroke']) {
      const val = el.getAttribute(attr);
      if (val && val.includes('var(')) {
        el.setAttribute(attr, val.replace(varPattern, (_, name) => vars[name] || '#888'));
      }
    }
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

// Renders the resolved SVG string onto an offscreen canvas at `scale`x and
// returns a PNG data URL. Uses an Image + data:image/svg+xml round-trip
// (no external rasterizer) — the standard no-dependency way to rasterize
// inline SVG in a browser.
export function svgToPngDataUrl(svgEl, scale = 2) {
  const svgString = svgToSvgString(svgEl);
  const width = svgEl.clientWidth || svgEl.viewBox.baseVal.width;
  const height = svgEl.clientHeight || svgEl.viewBox.baseVal.height;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  });
}
