/**
 * The Watchdog mark, built with DOM APIs (no innerHTML) so it can be injected
 * into the overlay's shadow root. Geometry mirrors public/icons/logo.svg —
 * keep the two in sync.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const EAR_LEFT = 'M47 38 Q26 43 23 67 Q21 88 35 95 Q45 99 48 88 Q43 77 43 63 L43 47 Z';
const EAR_RIGHT = 'M81 38 Q102 43 105 67 Q107 88 93 95 Q83 99 80 88 Q85 77 85 63 L85 47 Z';

/** Carves a gap between the ears and the head so the silhouette reads at small sizes. */
const HEAD_GAP = 'M64 24 Q89 24 89 50 L89 68 Q89 85 79 94 Q72 100 64 100 Q56 100 49 94 Q39 85 39 68 L39 50 Q39 24 64 24 Z';

const HEAD =
  'M64 28 Q85 28 85 50 L85 68 Q85 82 77 90 Q71 96 64 96 Q57 96 51 90 Q43 82 43 68 L43 50 Q43 28 64 28 Z ' +
  'M55 58 a5 5 0 1 0 0.1 0 Z ' +
  'M73 58 a5 5 0 1 0 0.1 0 Z ' +
  'M64 77 a7 5.5 0 1 0 0.1 0 Z';

// Each instance needs its own gradient id; two marks on one page must not collide.
let instanceCount = 0;

function path(d: string, fill: string, evenOdd = false): SVGPathElement {
  const node = document.createElementNS(SVG_NS, 'path');
  node.setAttribute('d', d);
  node.setAttribute('fill', fill);
  if (evenOdd) node.setAttribute('fill-rule', 'evenodd');
  return node;
}

export function createLogo(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');

  const gradientId = `wd-logo-${++instanceCount}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  gradient.setAttribute('id', gradientId);
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '1');
  gradient.setAttribute('y2', '1');
  for (const [offset, color] of [['0', '#6366f1'], ['1', '#4338ca']] as const) {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);

  const tile = document.createElementNS(SVG_NS, 'rect');
  tile.setAttribute('width', '128');
  tile.setAttribute('height', '128');
  tile.setAttribute('rx', '28');
  tile.setAttribute('fill', `url(#${gradientId})`);

  svg.append(
    defs,
    tile,
    path(EAR_LEFT, '#ffffff'),
    path(EAR_RIGHT, '#ffffff'),
    path(HEAD_GAP, `url(#${gradientId})`),
    path(HEAD, '#ffffff', true),
  );
  return svg;
}
