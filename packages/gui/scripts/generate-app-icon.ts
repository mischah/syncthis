#!/usr/bin/env tsx
/**
 * Generate application icons for syncthis.
 *
 * Outputs to packages/gui/resources/:
 *   icon.png          — 1024×1024 master PNG
 *   icon.icns         — macOS app icon (requires iconutil, macOS only)
 *   icons/icon-N.png  — 16, 32, 64, 128, 256, 512, 1024 px PNGs
 *
 * Run: npx tsx packages/gui/scripts/generate-app-icon.ts
 */

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONOIR_DIR = join(__dirname, '../../../node_modules/iconoir/icons/regular');
const RESOURCES_DIR = join(__dirname, '../resources');
const ICONS_DIR = join(RESOURCES_DIR, 'icons');

const ACCENT = '#4A7BDB';
const SIZES = [16, 32, 64, 128, 256, 512, 1024];

// ---------------------------------------------------------------------------
// SVG composition
// ---------------------------------------------------------------------------

/**
 * Build the 1024×1024 app icon SVG:
 *   - rounded-rect background in the app accent color (#4A7BDB)
 *   - cloud-check icon (white, ~60% of canvas) centered
 */
function buildIconSvg(): string {
  const src = readFileSync(join(ICONOIR_DIR, 'cloud-check.svg'), 'utf8');
  const paths = [...src.matchAll(/<path\s[^>]+\/>/g)].map((m) => m[0]);

  // Place icon at 60% of the 1024×1024 canvas, centered.
  // Scale factor: cloudPx / 24 (Iconoir viewBox is 24×24).
  const cloudPx = Math.round(1024 * 0.6); // 614
  const offset = Math.round((1024 - cloudPx) / 2); // 205
  const scale = (cloudPx / 24).toFixed(4); // 25.5833

  return [
    '<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">',
    `  <rect width="1024" height="1024" rx="230" ry="230" fill="${ACCENT}"/>`,
    `  <g transform="translate(${offset}, ${offset}) scale(${scale})"`,
    '     fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">',
    ...paths.map((p) => `    ${p.replace(/currentColor/g, '#ffffff')}`),
    '  </g>',
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function renderPng(svg: string, size: number, outputPath: string): Promise<void> {
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(outputPath);
  console.log(`  ✓ ${outputPath.replace(`${RESOURCES_DIR}/`, '')}  (${size}×${size})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Generating app icons...\n');

  mkdirSync(ICONS_DIR, { recursive: true });
  const svg = buildIconSvg();

  // Master PNG + discrete sizes
  console.log('[sizes]');
  await renderPng(svg, 1024, join(RESOURCES_DIR, 'icon.png'));
  for (const size of SIZES) {
    await renderPng(svg, size, join(ICONS_DIR, `icon-${size}.png`));
  }

  // macOS .icns via iconutil
  if (process.platform === 'darwin') {
    console.log('\n[icns]');
    const iconsetDir = join(RESOURCES_DIR, 'icon.iconset');
    mkdirSync(iconsetDir, { recursive: true });

    // macOS iconset: logical size → physical size mapping
    const iconsetEntries: Array<[number, string]> = [
      [16, 'icon_16x16.png'],
      [32, 'icon_16x16@2x.png'],
      [32, 'icon_32x32.png'],
      [64, 'icon_32x32@2x.png'],
      [128, 'icon_128x128.png'],
      [256, 'icon_128x128@2x.png'],
      [256, 'icon_256x256.png'],
      [512, 'icon_256x256@2x.png'],
      [512, 'icon_512x512.png'],
      [1024, 'icon_512x512@2x.png'],
    ];

    for (const [size, filename] of iconsetEntries) {
      copyFileSync(join(ICONS_DIR, `icon-${size}.png`), join(iconsetDir, filename));
      console.log(`  ✓ icon.iconset/${filename}`);
    }

    try {
      execSync(`iconutil -c icns -o "${join(RESOURCES_DIR, 'icon.icns')}" "${iconsetDir}"`, {
        stdio: 'pipe',
      });
      console.log('  ✓ icon.icns');
    } catch (err) {
      console.error('  ✗ iconutil failed:', err);
    }

    rmSync(iconsetDir, { recursive: true, force: true });
  } else {
    console.log('\n[icns] Skipped — macOS only');
  }

  console.log('\nDone — icons written to resources/');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
