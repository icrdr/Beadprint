

import { MARD_COLORS } from "../constants";
import { PixelData } from "../types";
import { findNearestColor } from "./colorUtils";

export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

export async function generateCroppedPreview(
  imageSrc: string,
  crop: { x: number, y: number, width: number, height: number }
): Promise<string> {
  return new Promise(async (resolve, reject) => {
      try {
        const img = await createImage(imageSrc);
        const canvas = document.createElement('canvas');
        // Limit preview size for performance and UI display (e.g., 512px square)
        const size = 512; 
        canvas.width = size;
        canvas.height = size;
        
        const ctx = canvas.getContext('2d');
        if(!ctx) return reject('No context');
        
        // Use high quality smoothing for the UI preview
        ctx.imageSmoothingEnabled = true; 
        ctx.imageSmoothingQuality = 'high';

        // Calculate scaling based on the Crop Width (source space) -> Target Size (512)
        const scale = size / crop.width;
        
        // Calculate where the image should be drawn relative to the canvas origin
        // Crop TopLeft is "World 0,0" for the canvas
        // Image TopLeft is at (0 - crop.x, 0 - crop.y) in World space
        // Then scale it
        const drawX = -crop.x * scale;
        const drawY = -crop.y * scale;
        const drawW = img.width * scale;
        const drawH = img.height * scale;

        // Clear with transparency (default, but good to be explicit if reused)
        ctx.clearRect(0,0, size, size);

        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        
        resolve(canvas.toDataURL('image/png'));
      } catch(e) {
          reject(e);
      }
  });
}

export async function processImageToGrid(
  imageSrc: string,
  crop: { x: number, y: number, width: number, height: number },
  resolution: number, // Total Width in beads
  availableColors: string[] | null
): Promise<(PixelData | null)[][]> {
  const img = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error("No Canvas Context");
  
  canvas.width = resolution;
  canvas.height = resolution;

  // Draw cropped image scaled down
  ctx.imageSmoothingEnabled = false; // Pixel art style
  
  // Calculate mapping from Crop Space to Resolution Grid
  const scale = resolution / crop.width;
  
  const drawX = -crop.x * scale;
  const drawY = -crop.y * scale;
  const drawW = img.width * scale;
  const drawH = img.height * scale;

  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  const imageData = ctx.getImageData(0, 0, resolution, resolution);
  const data = imageData.data;
  const grid: (PixelData | null)[][] = [];

  for (let y = 0; y < resolution; y++) {
    const row: (PixelData | null)[] = [];
    for (let x = 0; x < resolution; x++) {
      const i = (y * resolution + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      // Transparency Check
      if (a < 50) {
        row.push(null);
      } else {
        // Simple Hex conversion
        const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        const nearest = findNearestColor(hex, availableColors);
        
        row.push({
          x,
          y,
          colorCode: nearest.code,
          hex: nearest.hex
        });
      }
    }
    grid.push(row);
  }

  return grid;
}

/**
 * Adds an outline of beads around non-transparent beads.
 * @param grid The current pixel grid
 * @param width Number of beads for the outline width
 * @param colorCode The MARD color code for the outline
 */
export function applyOutline(
  grid: (PixelData | null)[][], 
  width: number, 
  colorCode: string
): (PixelData | null)[][] {
  if (width <= 0) return grid;
  if (grid.length === 0) return grid;

  const rows = grid.length;
  const cols = grid[0].length;
  const outlineHex = MARD_COLORS[colorCode] || '#FFFFFF';

  // We iterate 'width' times to grow the outline layer by layer
  let currentGrid = grid;

  for (let w = 0; w < width; w++) {
    // Create a new grid for this iteration to avoid polluting checks
    const nextGrid: (PixelData | null)[][] = currentGrid.map(row => [...row]);
    
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // Only interested in Empty pixels to potentially turn them into Outline
        if (currentGrid[y][x] === null) {
          // Check neighbors (8-way or 4-way? 8-way is usually better for outlines)
          let hasNeighbor = false;
          
          // Check 8 neighbors
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              
              const ny = y + dy;
              const nx = x + dx;
              
              if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                if (currentGrid[ny][nx] !== null) {
                  hasNeighbor = true;
                  break;
                }
              }
            }
            if (hasNeighbor) break;
          }

          if (hasNeighbor) {
            nextGrid[y][x] = {
              x, y,
              colorCode: colorCode,
              hex: outlineHex
            };
          }
        }
      }
    }
    currentGrid = nextGrid;
  }

  return currentGrid;
}


export function downloadFile(content: Blob, fileName: string) {
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}