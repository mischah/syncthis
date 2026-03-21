#!/usr/bin/env tsx
/**
 * Generate tray icons from Iconoir SVGs.
 *
 * Outputs to packages/gui/resources/tray/:
 *   macOS template images — monochrome black, 22×22 @1x and 44×44 @2x
 *   Linux standard icons  — colored, 24×24
 *   Syncing animation     — 8 rotated frames per size variant
 *
 * Run: npx tsx packages/gui/scripts/generate-tray-icons.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONOIR_DIR = join(__dirname, '../../../node_modules/iconoir/icons/regular');
const OUTPUT_DIR = join(__dirname, '../resources/tray');

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function readSvg(name: string): string {
  return readFileSync(join(ICONOIR_DIR, `${name}.svg`), 'utf8');
}

/** Replace `currentColor` with a concrete hex value. */
function setColor(svg: string, color: string): string {
  return svg.replace(/currentColor/g, color);
}

/**
 * Compensate stroke-width for downscaling.
 * Iconoir uses 1.5px on a 24×24 viewBox. When rendered at a smaller content
 * size the strokes become physically thinner. Scale stroke-width inversely so
 * the rendered weight stays constant, with a base of 2.5 for slightly bolder
 * appearance at menu-bar size: new = 2.5 × (24 / contentSize).
 */
function compensateStroke(svg: string, contentSize: number): string {
  const adjusted = ((2.5 * 24) / contentSize).toFixed(2);
  return svg.replace(/stroke-width="[\d.]+"/g, `stroke-width="${adjusted}"`);
}

/**
 * Append a small filled-circle badge in the lower-right of the 24×24 viewbox.
 * Black for macOS template images; red for Linux (where color is visible).
 */
function addBadge(svg: string, forTemplate: boolean): string {
  const color = forTemplate ? '#000000' : '#C4422B';
  const dot = `<circle cx="19.5" cy="18.5" r="3.5" fill="${color}"/>`;
  return svg.replace('</svg>', `${dot}</svg>`);
}

/**
 * Shift the SVG viewport down by `dy` units so content appears higher.
 * The plain cloud.svg sits ~2 units lower than cloud-check/cloud-sync;
 * this aligns the cloud position across all tray icon states.
 */
function shiftUp(svg: string, dy: number): string {
  return svg.replace('viewBox="0 0 24 24"', `viewBox="0 ${dy} 24 24"`);
}

// ---------------------------------------------------------------------------
// Syncing animation — rotate arrows inside a clipped cloud
// ---------------------------------------------------------------------------

const SYNCING_FRAMES = 8;

/**
 * Parse the cloud-sync SVG into its cloud outline and arrow paths.
 * The Iconoir cloud-sync SVG has 5 <path> elements:
 *   [0] cloud outline  [1-2] first arrow + head  [3-4] second arrow + head
 */
function parseSyncParts(svg: string): { cloud: string; arrows: string[] } {
  const paths = [...svg.matchAll(/<path\s[^>]+\/>/g)].map((m) => m[0]);
  return { cloud: paths[0], arrows: paths.slice(1) };
}

/**
 * Build a syncing-frame SVG with arrows rotated by `angle` degrees.
 * A clipPath based on the closed cloud outline prevents rotated arrows from
 * poking outside the cloud boundary.
 */
function buildSyncFrame(color: string, angle: number): string {
  const colored = setColor(readSvg('cloud-sync'), color);
  const { cloud, arrows } = parseSyncParts(colored);

  // Extract the d="..." from the cloud path to build the clipPath.
  // Close the open cloud path by extending to the bottom of the viewBox.
  const dMatch = cloud.match(/d="([^"]+)"/);
  const cloudD = dMatch ? dMatch[1] : '';
  const clipD = `${cloudD} L4 24 L20 24 Z`;

  return [
    '<svg width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
    '  <defs>',
    `    <clipPath id="c"><path d="${clipD}"/></clipPath>`,
    '  </defs>',
    `  ${cloud}`,
    `  <g clip-path="url(#c)" transform="rotate(${angle}, 12, 18.2)">`,
    ...arrows.map((a) => `    ${a}`),
    '  </g>',
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Static icon definitions
// ---------------------------------------------------------------------------

const cloudCheck = readSvg('cloud-check');
const cloud = readSvg('cloud');

interface IconDef {
  name: string;
  /** Return SVG string for the given rendering context. */
  svgFn: (forTemplate: boolean) => string;
}

const staticIcons: IconDef[] = [
  {
    name: 'idle',
    svgFn: (t) => setColor(cloudCheck, t ? '#000000' : '#555555'),
  },
  {
    name: 'unhealthy',
    svgFn: (t) => addBadge(shiftUp(setColor(cloud, t ? '#000000' : '#555555'), 2), t),
  },
];

// ---------------------------------------------------------------------------
// Size / filename specs
// ---------------------------------------------------------------------------

interface SizeSpec {
  size: number; // final PNG canvas size
  contentSize: number; // SVG rendered at this size (visual ink area)
  suffix: string;
  isTemplate: boolean;
}

const sizes: SizeSpec[] = [
  { size: 22, contentSize: 18, suffix: 'Template', isTemplate: true }, // macOS @1x
  { size: 44, contentSize: 36, suffix: 'Template@2x', isTemplate: true }, // macOS @2x
  { size: 24, contentSize: 20, suffix: '', isTemplate: false }, // Linux
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function renderIcon(
  svgStr: string,
  size: number,
  contentSize: number,
  outputPath: string,
): Promise<void> {
  const pad = Math.floor((size - contentSize) / 2);
  const padEnd = size - contentSize - pad;
  await sharp(Buffer.from(compensateStroke(svgStr, contentSize)), {
    density: 300,
  })
    .resize(contentSize, contentSize)
    .extend({
      top: pad,
      bottom: padEnd,
      left: pad,
      right: padEnd,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outputPath);
  console.log(`  ✓ ${outputPath.replace(`${OUTPUT_DIR}/`, '')}  (${size}×${size})`);
}

async function main(): Promise<void> {
  console.log('Generating tray icons...\n');

  // Static icons (idle, unhealthy)
  for (const icon of staticIcons) {
    console.log(`[${icon.name}]`);
    for (const { size, contentSize, suffix, isTemplate } of sizes) {
      const svgStr = icon.svgFn(isTemplate);
      const filename = `tray-${icon.name}${suffix}.png`;
      await renderIcon(svgStr, size, contentSize, join(OUTPUT_DIR, filename));
    }
  }

  // Syncing animation frames
  console.log(`[syncing] (${SYNCING_FRAMES} frames)`);
  for (let frame = 0; frame < SYNCING_FRAMES; frame++) {
    const angle = frame * (360 / SYNCING_FRAMES);
    for (const { size, contentSize, suffix, isTemplate } of sizes) {
      const color = isTemplate ? '#000000' : '#555555';
      const svgStr = buildSyncFrame(color, angle);
      const filename = `tray-syncing-${frame}${suffix}.png`;
      await renderIcon(svgStr, size, contentSize, join(OUTPUT_DIR, filename));
    }
  }

  const total = staticIcons.length * sizes.length + SYNCING_FRAMES * sizes.length;
  console.log(`\nDone — ${total} icons written to resources/tray/`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
