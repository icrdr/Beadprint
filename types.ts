
export interface MardColor {
  code: string;
  hex: string;
}

export interface Preset {
  name: string;
  name_en?: string;
  description: string;
  description_en?: string;
  colors: string[] | null;
}

export interface PixelData {
  x: number;
  y: number;
  colorCode: string; // The MARD code
  hex: string;
}

export interface ColorCount {
  code: string;
  hex: string;
  count: number;
}

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface AppState {
  image: HTMLImageElement | null;
  crop: { x: number; y: number };
  zoom: number;
  croppedAreaPixels: any | null;
  
  // Settings
  resolution: number; // Beads per block side
  partitions: number; // Number of blocks (e.g., 2 means 2x2 blocks)
  selectedPresetKey: string;
  maxColors: number;
  layoutRatio: '3:4' | '4:3';
  
  // Data
  gridData: (PixelData | null)[][]; // [y][x], null = transparent
  mergedGridData: (PixelData | null)[][]; // After color reduction
  
  // UI State
  isProcessing: boolean;
  theme: 'light' | 'dark' | 'system';
  language: 'zh' | 'en';
  currentSheet: number; // Index of the current partition being viewed
  viewTransform: ViewTransform;
}

export type Theme = 'light' | 'dark' | 'system';
export type Language = 'zh' | 'en';
