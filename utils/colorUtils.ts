
import { MARD_COLORS } from '../constants';
import { ColorCount, PixelData } from '../types';

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

// Simple Euclidean distance in RGB space
function getDistance(c1: { r: number, g: number, b: number }, c2: { r: number, g: number, b: number }) {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
}

export function findNearestColor(hex: string, availableColors: string[] | null = null): { code: string, hex: string } {
  const target = hexToRgb(hex);
  let minDistance = Infinity;
  let nearestCode = 'H7'; // Default black
  let nearestHex = '#000000';

  const keys = availableColors ? availableColors : Object.keys(MARD_COLORS);

  for (const key of keys) {
    const colorHex = MARD_COLORS[key];
    if (!colorHex) continue;

    const current = hexToRgb(colorHex);
    const dist = getDistance(target, current);

    if (dist < minDistance) {
      minDistance = dist;
      nearestCode = key;
      nearestHex = colorHex;
    }
  }

  return { code: nearestCode, hex: nearestHex };
}

/**
 * Finds the nearest color from a restricted palette (used for merging)
 */
export function findNearestInPalette(sourceCode: string, paletteCodes: string[]): { code: string, hex: string } | null {
  const sourceHex = MARD_COLORS[sourceCode];
  if (!sourceHex) return null;
  const targetRgb = hexToRgb(sourceHex);

  let minDistance = Infinity;
  let nearestCode = null;
  let nearestHex = null;

  for (const code of paletteCodes) {
    if (code === sourceCode) continue; // Don't match self

    const hex = MARD_COLORS[code];
    const rgb = hexToRgb(hex);
    const dist = getDistance(targetRgb, rgb);

    if (dist < minDistance) {
      minDistance = dist;
      nearestCode = code;
      nearestHex = hex;
    }
  }

  if (nearestCode && nearestHex) {
    return { code: nearestCode, hex: nearestHex };
  }
  return null;
}

export function countColors(grid: (PixelData | null)[][]): ColorCount[] {
  const counts: Record<string, number> = {};
  
  grid.forEach(row => {
    row.forEach(pixel => {
      if (pixel) {
        counts[pixel.colorCode] = (counts[pixel.colorCode] || 0) + 1;
      }
    });
  });

  return Object.entries(counts)
    .map(([code, count]) => ({
      code,
      hex: MARD_COLORS[code],
      count
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Smart Color Reduction (Agglomerative Clustering)
 */
export function reduceColorsSmart(grid: (PixelData | null)[][], maxColors: number): (PixelData | null)[][] {
  // 1. Get all unique colors currently in use
  const counts = countColors(grid);
  
  // If we already have fewer or equal colors, do nothing
  if (counts.length <= maxColors) return grid;

  // Working set of colors: { code, hex, rgb, count, active }
  const colorMap: Record<string, string> = {}; 
  const activeColors = counts.map(c => ({
    code: c.code,
    hex: c.hex,
    rgb: hexToRgb(c.hex),
    count: c.count
  }));

  let currentCount = activeColors.length;

  // 2. Iteratively merge closest pair
  while (currentCount > maxColors) {
    let minDist = Infinity;
    let bestPair = [-1, -1];

    // Find closest pair of ACTIVE colors
    for (let i = 0; i < activeColors.length; i++) {
      if (colorMap[activeColors[i].code]) continue; // Already merged away

      for (let j = i + 1; j < activeColors.length; j++) {
        if (colorMap[activeColors[j].code]) continue; // Already merged away

        const dist = getDistance(activeColors[i].rgb, activeColors[j].rgb);
        if (dist < minDist) {
          minDist = dist;
          bestPair = [i, j];
        }
      }
    }

    if (bestPair[0] === -1) break; // Should not happen

    const idxA = bestPair[0];
    const idxB = bestPair[1];
    const colA = activeColors[idxA];
    const colB = activeColors[idxB];

    // Decide who merges into whom
    // Rule: Merge the one with LOWER count into HIGHER count to preserve dominant structure.
    let survivor, victim;
    if (colA.count >= colB.count) {
      survivor = colA;
      victim = colB;
    } else {
      survivor = colB;
      victim = colA;
    }

    // Record Merge
    colorMap[victim.code] = survivor.code;
    
    // Update survivor count (approximate)
    survivor.count += victim.count;
    
    currentCount--;
  }

  // 3. Resolve Chained Merges
  const finalMap: Record<string, { code: string, hex: string }> = {};
  
  counts.forEach(c => {
    let target = c.code;
    while (colorMap[target]) {
      target = colorMap[target];
    }
    finalMap[c.code] = {
      code: target,
      hex: MARD_COLORS[target]
    };
  });

  // 4. Remap Grid
  return grid.map(row => 
    row.map(pixel => {
      if (!pixel) return null;

      const mapping = finalMap[pixel.colorCode];
      if (mapping && mapping.code !== pixel.colorCode) {
        return {
          ...pixel,
          colorCode: mapping.code,
          hex: mapping.hex
        };
      }
      return pixel;
    })
  );
}

// Replace a specific color globally (Manual Merge)
export function mergeColorInGrid(grid: (PixelData | null)[][], sourceCode: string, targetCode: string): (PixelData | null)[][] {
  const targetHex = MARD_COLORS[targetCode];
  return grid.map(row => 
    row.map(pixel => {
      if (!pixel) return null;
      if (pixel.colorCode === sourceCode) {
        return {
          ...pixel,
          colorCode: targetCode,
          hex: targetHex
        };
      }
      return pixel;
    })
  );
}

// Merge all colors with count < threshold into the nearest dominant color
export function mergeSmallCounts(grid: (PixelData | null)[][], threshold: number = 10): (PixelData | null)[][] {
  const counts = countColors(grid);
  
  // Separate into 'Keepers' (count >= threshold) and 'Sources' (count < threshold)
  let keepers = counts.filter(c => c.count >= threshold);
  const sources = counts.filter(c => c.count < threshold);
  
  if (sources.length === 0) return grid; // Nothing to merge

  // If no keepers (everything is small), promote the largest small one to keeper
  if (keepers.length === 0) {
     keepers = [sources[0]];
     sources.shift();
     if (sources.length === 0) return grid; // Only 1 color existed
  }

  const keeperCodes = keepers.map(k => k.code);
  const mapping: Record<string, { code: string, hex: string }> = {};

  // Find nearest keeper for each source
  sources.forEach(src => {
      const target = findNearestInPalette(src.code, keeperCodes);
      if (target) {
          mapping[src.code] = target;
      }
  });

  // Apply map
  return grid.map(row => 
    row.map(pixel => {
      if (!pixel) return null;
      if (mapping[pixel.colorCode]) {
        return {
          ...pixel,
          colorCode: mapping[pixel.colorCode].code,
          hex: mapping[pixel.colorCode].hex
        };
      }
      return pixel;
    })
  );
}
