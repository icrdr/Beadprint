import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Upload, Download, Grid, Sun, Moon, Monitor, RefreshCw, Languages, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, ToggleLeft, ToggleRight, Loader2, Maximize, Image as ImageIcon, PaintBucket } from 'lucide-react';
import { COLOR_PRESETS, UI_TEXT, MARD_COLORS } from './constants';
import { PixelData, Language, Theme, ViewTransform } from './types';
import { processImageToGrid, downloadFile, generateCroppedPreview, applyOutline } from './utils/imageUtils';
import { countColors, reduceColorsSmart, mergeColorInGrid, findNearestInPalette, mergeSmallCounts } from './utils/colorUtils';
import { Button } from './components/ui/Button';
import { Slider } from './components/ui/Slider';
import { CropperModal } from './components/CropperModal';
import { DownloadModal } from './components/DownloadModal';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';

const ColorDot = ({ hex, size = 'md' }: { hex: string, size?: 'sm' | 'md' | 'lg' }) => {
  const sizes = { sm: 'w-3 h-3', md: 'w-5 h-5', lg: 'w-8 h-8' };
  return (
    <div 
      className={`${sizes[size]} rounded-full border border-black/10 shadow-sm`} 
      style={{ backgroundColor: hex }}
    />
  );
};

// Interactive Partition Preview Component (The "田" view)
const PartitionPreview = ({ 
  count, 
  currentSheet, 
  onSelect 
}: { 
  count: number, 
  currentSheet: number, 
  onSelect: (idx: number) => void 
}) => {
    return (
      <div className="grid gap-px bg-neutral-200 dark:bg-neutral-800 p-1 border dark:border-neutral-700 rounded shadow-sm" 
           style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
        {Array.from({ length: count * count }).map((_, i) => {
            const r = Math.floor(i / count);
            const c = i % count;
            const label = `${String.fromCharCode(65 + r)}${c + 1}`;
            const isActive = i === currentSheet;
            return (
              <button 
                key={i} 
                onClick={() => onSelect(i)}
                className={`flex w-6 h-6 items-center justify-center text-[10px] font-mono font-bold transition-colors
                  ${isActive 
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black' 
                    : 'bg-white dark:bg-neutral-600 text-neutral-500 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-500'
                  }`}
              >
                {label}
              </button>
            );
        })}
      </div>
    );
};

export default function App() {
  // --- State ---
  const [lang, setLang] = useState<Language>('zh');
  const [theme, setTheme] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  
  const [file, setFile] = useState<string | null>(null);
  const [tempFile, setTempFile] = useState<string | null>(null); // Temporary file for cropping
  const [showCropper, setShowCropper] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  
  // Logic Settings (committed)
  const [resolution, setResolution] = useState(24); 
  const [partitions, setPartitions] = useState(1);
  const [maxColors, setMaxColors] = useState<number>(64);
  const [outlineWidth, setOutlineWidth] = useState(1);
  const [outlineColor, setOutlineColor] = useState('H7'); // Default Black, will sync with theme
  
  // UI Settings (instant)
  const [uiResolution, setUiResolution] = useState(24);
  const [uiPartitions, setUiPartitions] = useState(1);
  const [uiMaxColors, setUiMaxColors] = useState(64);

  const [layoutRatio, setLayoutRatio] = useState<'3:4' | '4:3'>('3:4');
  const [selectedPreset, setSelectedPreset] = useState('all_colors');
  const [showGridLines, setShowGridLines] = useState(true);
  const [pageMargin, setPageMargin] = useState(90);

  // Tools
  const [mergeThreshold, setMergeThreshold] = useState(10);

  // Data State
  const [grid, setGrid] = useState<(PixelData | null)[][]>([]);
  const [croppedPixelData, setCroppedPixelData] = useState<any>(null); 
  
  // Post-Processing State
  const [finalGrid, setFinalGrid] = useState<(PixelData | null)[][]>([]);
  
  // Download State
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [storedFilename, setStoredFilename] = useState('');

  // UI State
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSheet, setCurrentSheet] = useState(0); 
  
  // Canvas Viewport State - Start at 100% (1.0)
  const [viewTransform, setViewTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1.0 }); 
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t = UI_TEXT[lang];

  // --- Effects ---

  // Theme Handling
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    let effectiveTheme: 'light' | 'dark' = 'light';
    
    if (theme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      effectiveTheme = theme;
    }
    
    root.classList.add(effectiveTheme);
    setResolvedTheme(effectiveTheme);
  }, [theme]);

  // Sync Outline Color with Theme (Smart Default)
  useEffect(() => {
    // If user is on Dark mode, default outline should be White (H1) for visibility
    // If user is on Light mode, default outline should be Black (H7)
    // We only swap if the current color is the "opposite" default to avoid overriding user selection
    if (resolvedTheme === 'dark') {
        if (outlineColor === 'H7') setOutlineColor('H1');
    } else {
        if (outlineColor === 'H1') setOutlineColor('H7');
    }
  }, [resolvedTheme]);

  // Main Processing Pipeline
  useEffect(() => {
    if (!file || !croppedPixelData) return;

    const process = async () => {
      setIsProcessing(true);
      await new Promise(r => setTimeout(r, 50));
      
      const totalRes = resolution * partitions;
      const presetColors = COLOR_PRESETS[selectedPreset].colors;
      
      try {
        const croppedPreview = await generateCroppedPreview(file, croppedPixelData);
        setPreviewSrc(croppedPreview);

        // 1. Generate Base Grid (Handles Transparency)
        const rawGrid = await processImageToGrid(file, croppedPixelData, totalRes, presetColors);
        setGrid(rawGrid);
      } catch (err) {
        console.error("Processing failed", err);
      } finally {
        setIsProcessing(false);
      }
    };

    process();

  }, [file, croppedPixelData, resolution, partitions, selectedPreset]);

  // Smart Color Reduction & Outline
  // Runs whenever Grid changes OR maxColors OR outline settings change
  useEffect(() => {
    if (grid.length === 0) return;
    
    const runOptimization = async () => {
        // 1. Reduce Colors (on non-null pixels)
        const reduced = reduceColorsSmart(grid, maxColors);
        
        // 2. Apply Outline (if width > 0)
        // Note: Outline beads are added to null spots.
        const outlined = applyOutline(reduced, outlineWidth, outlineColor);

        setFinalGrid(outlined);
    };
    runOptimization();

  }, [grid, maxColors, outlineWidth, outlineColor]);

  // Auto-fit view when a new final grid is first generated (e.g. upload)
  useEffect(() => {
    if (finalGrid.length > 0 && !isProcessing) {
        if (viewTransform.scale === 1.0) {
            handleFitView();
        }
    }
  }, [finalGrid]);

  // Reset Sheet index when partitions change
  useEffect(() => {
    setCurrentSheet(0);
  }, [partitions]);

  // --- Logic & Helpers ---

  const currentColors = useMemo(() => countColors(finalGrid), [finalGrid]);
  const availableColorCount = useMemo(() => Math.min(64, countColors(grid).length), [grid]);

  useEffect(() => {
    if (uiMaxColors > availableColorCount && availableColorCount > 1) {
       setUiMaxColors(availableColorCount);
       setMaxColors(availableColorCount);
    }
  }, [availableColorCount]);

  useEffect(() => {
      const max = 64;
      setUiMaxColors(max);
      setMaxColors(max);
  }, [resolution, partitions]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Reset logic handled in confirm
      const reader = new FileReader();
      reader.onload = () => {
        setTempFile(reader.result as string);
        setShowCropper(true);
        // Reset file input value so same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleCropperCancel = () => {
      setTempFile(null);
      setShowCropper(false);
  };

  // The callback now only receives the pixel data since we handle save logic in Modal better
  const handleCropperConfirm = (imgSrc: string, pixelData: any) => {
      if (!pixelData) return; // Should not happen

      // RESET SETTINGS ON NEW IMAGE
      setResolution(24);
      setUiResolution(24);
      setPartitions(1);
      setUiPartitions(1);
      setMaxColors(64);
      setUiMaxColors(64);
      setOutlineWidth(1); 
      setStoredFilename(''); // Reset persisted filename

      // Use tempFile as the main file
      if (tempFile) setFile(tempFile);
      setCroppedPixelData(pixelData);
      setTempFile(null);
      setShowCropper(false);
  };

  const handleOneClickMerge = (colorCode: string) => {
    const paletteCodes = currentColors.map(c => c.code);
    const target = findNearestInPalette(colorCode, paletteCodes);

    if (target) {
        const newGrid = mergeColorInGrid(finalGrid, colorCode, target.code);
        setFinalGrid(newGrid);
    }
  };

  const handleMergeSmallColors = () => {
      const newGrid = mergeSmallCounts(finalGrid, mergeThreshold);
      setFinalGrid(newGrid);
  };

  const handleFitView = () => {
    if (!mainRef.current) return;
    const containerH = mainRef.current.clientHeight;
    // Adapt to layout ratio
    const canvasH = layoutRatio === '3:4' ? 3200 : 2400; 
    const padding = 60; 
    const newScale = (containerH - padding) / canvasH;
    
    setViewTransform({
        x: 0,
        y: 0,
        scale: Math.min(newScale, 1.5)
    });
  };

  const getColLabel = (index: number) => {
    let label = '';
    let i = index;
    while (i >= 0) {
        label = String.fromCharCode(65 + (i % 26)) + label;
        i = Math.floor(i / 26) - 1;
    }
    return label;
  };

  const getPartitionLabel = (index: number, totalPartitions: number) => {
    const r = Math.floor(index / totalPartitions);
    const c = index % totalPartitions;
    return `${String.fromCharCode(65 + r)}${c + 1}`; 
  };

  // --- Canvas Drawing Logic ---

  const drawBlueprintSheet = useCallback((
    ctx: CanvasRenderingContext2D,
    sheetIndex: number,
    fullGrid: (PixelData | null)[][],
    blockSize: number, 
    partitions: number,
    layout: '3:4' | '4:3',
    width: number,
    height: number,
    showGrid: boolean,
    margin: number,
    isDark: boolean
  ) => {
    const cBg = isDark ? '#141414' : '#FFFFFF'; 
    const cText = isDark ? '#EEEEEE' : '#000000';
    const cGrid = isDark ? '#444444' : '#e5e5e5';
    const cGridStroke = isDark ? '#333333' : '#f0f0f0';
    const cRuler = isDark ? '#888888' : '#888888';
    const cHighlightDash = isDark ? '#FFFFFF' : '#000000';
    const cHighlightSolid = isDark ? '#000000' : '#FFFFFF'; 

    const isPortrait = layout === '3:4';
    const label = getPartitionLabel(sheetIndex, partitions);

    // Clear background
    ctx.fillStyle = cBg;
    ctx.fillRect(0, 0, width, height);
    
    const rulerOffset = 40; 
    const safeW = width - (2 * margin);
    const safeH = height - (2 * margin);

    let gridRect, previewRect, bomRect, labelPos;

    // Define Layout Areas
    if (isPortrait) {
        const contentGap = 120;
        // Portrait Layout: Grid on top, Details at bottom
        const maxGridH = (safeH - contentGap - 100) * 0.75; 
        const gridSize = Math.floor(Math.min(safeW, maxGridH));
        const previewSize = gridSize / 3; 
        
        gridRect = {
            x: margin + (safeW - gridSize) / 2,
            y: margin,
            w: gridSize,
            h: gridSize
        };

        const bottomY = margin + gridSize + contentGap;
        previewRect = {
            x: gridRect.x, 
            y: bottomY,
            w: previewSize,
            h: previewSize
        };
        labelPos = {
            x: previewRect.x + previewSize / 2,
            y: previewRect.y + previewSize + 40
        };
        const bomX = gridRect.x + previewSize + contentGap;
        bomRect = {
            x: bomX,
            y: bottomY,
            w: (gridRect.x + gridSize) - bomX,
            h: (height - margin - 60) - bottomY
        };

    } else {
        // Landscape Layout (4:3) - Width 3200, Height 2400
        const contentGap = 100; // Gap between Grid and Sidebar
        
        // Structure: [Grid] [Gap] [Sidebar]
        // Sidebar Width = Grid / 3.
        // Total Content Width = Grid + Gap + Grid/3 = 1.333 * Grid + Gap.
        
        // 1. Calculate Grid Size to fit within Safe Area (both W and H)
        // Max Width Constraint: (Grid * 1.333) + Gap <= safeW
        const maxGridW = (safeW - contentGap) * 0.75; // approx 1/(1 + 1/3) = 3/4
        
        // Max Height Constraint: Grid <= safeH
        const maxGridH = safeH;
        
        const gridSize = Math.floor(Math.min(maxGridW, maxGridH));
        const sidebarWidth = gridSize / 3;
        
        const totalBlockWidth = gridSize + contentGap + sidebarWidth;
        const totalBlockHeight = gridSize;
        
        // Strictly Center the entire content block
        // X Offset = Left Margin + (Available Width - Used Width) / 2
        // Available Width = safeW (relative to margin) or Width (relative to 0)
        // Let's use absolute centering relative to canvas:
        
        const startX = (width - totalBlockWidth) / 2;
        const startY = (height - totalBlockHeight) / 2;
        
        gridRect = {
            x: startX,
            y: startY,
            w: gridSize,
            h: gridSize
        };

        const sidebarX = startX + gridSize + contentGap;

        // Preview at Top of Sidebar
        previewRect = {
            x: sidebarX,
            y: startY,
            w: sidebarWidth,
            h: sidebarWidth
        };
        
        labelPos = {
            x: previewRect.x + sidebarWidth / 2,
            y: previewRect.y + sidebarWidth + 40
        };
        
        // BOM below preview
        const bomY = labelPos.y + 60;
        bomRect = {
            x: sidebarX,
            y: bomY,
            w: sidebarWidth, 
            h: (startY + gridSize) - bomY
        };
    }

    // --- 1. Draw Main Grid ---
    
    const py = Math.floor(sheetIndex / partitions);
    const px = sheetIndex % partitions;
    const startX = px * blockSize;
    const startY = py * blockSize;

    if (fullGrid.length > 0) {
        const sheetRows = fullGrid.slice(startY, startY + blockSize);
        const sheetGrid = sheetRows.map(row => row.slice(startX, startX + blockSize));
        
        const cellSize = gridRect.w / blockSize;
        const gridDrawW = cellSize * blockSize;
        const gridDrawH = cellSize * blockSize;
        const offsetX = gridRect.x;
        const offsetY = gridRect.y;

        // Rulers
        if (showGrid) {
            ctx.fillStyle = cRuler;
            const rulerFontSize = Math.max(14, Math.min(36, cellSize * 0.6));
            ctx.font = `500 ${rulerFontSize}px "JetBrains Mono"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let x = 0; x < blockSize; x++) {
                const colTxt = getColLabel(x);
                const cx = offsetX + x * cellSize + cellSize / 2;
                ctx.fillText(colTxt, cx, offsetY - rulerOffset);
            }
            for (let y = 0; y < blockSize; y++) {
                const rowTxt = (y + 1).toString();
                const cy = offsetY + y * cellSize + cellSize / 2;
                ctx.fillText(rowTxt, offsetX - rulerOffset, cy);
            }
        }

        // Draw Pixels
        sheetGrid.forEach((row, y) => {
            row.forEach((pixel, x) => {
                const cx = offsetX + x * cellSize;
                const cy = offsetY + y * cellSize;
                
                if (showGrid) {
                    ctx.strokeStyle = cGrid;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(cx, cy, cellSize, cellSize);
                }

                if (!pixel) return; // Transparent

                ctx.fillStyle = pixel.hex;
                ctx.fillRect(cx, cy, cellSize, cellSize);
                
                // Stroke border for bead
                ctx.strokeStyle = showGrid ? cGrid : cGridStroke;
                ctx.lineWidth = 1;
                ctx.strokeRect(cx, cy, cellSize, cellSize);

                // Contrast Text
                const rgb = parseInt(pixel.hex.replace('#', ''), 16);
                const brightness = ((rgb >> 16) & 0xff) * 0.299 + ((rgb >> 8) & 0xff) * 0.587 + (rgb & 0xff) * 0.114;
                const textColor = brightness > 140 ? '#000' : '#fff';

                if (cellSize > 10) {
                    ctx.fillStyle = textColor;
                    ctx.font = `300 ${Math.max(16, Math.floor(cellSize * 0.4))}px "JetBrains Mono"`; 
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(pixel.colorCode, cx + cellSize/2, cy + cellSize/2);
                }
            });
        });

        // 5x5 Overlay
        if (showGrid) {
            ctx.strokeStyle = isDark ? '#888' : '#333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i <= blockSize; i += 5) {
                const lx = offsetX + i * cellSize;
                ctx.moveTo(lx, offsetY);
                ctx.lineTo(lx, offsetY + gridDrawH);
            }
            for (let i = 0; i <= blockSize; i += 5) {
                const ly = offsetY + i * cellSize;
                ctx.moveTo(offsetX, ly);
                ctx.lineTo(offsetX + gridDrawW, ly);
            }
            ctx.stroke();
            ctx.strokeRect(offsetX, offsetY, gridDrawW, gridDrawH);
        }
        
        // --- 2. Preview ---
        
        const pSize = previewRect.w;
        const pCell = pSize / Math.max(fullGrid.length, fullGrid[0]?.length || 1);
        const radius = pCell / 2;
        
        const previewOffsetX = previewRect.x;
        const previewOffsetY = previewRect.y;
        const useSquares = fullGrid.length > 64;

        fullGrid.forEach((row, y) => {
            row.forEach((pixel, x) => {
                if (!pixel) return;

                const cx = previewOffsetX + x * pCell + radius;
                const cy = previewOffsetY + y * pCell + radius;
                
                ctx.fillStyle = pixel.hex;
                
                if (useSquares) {
                    ctx.fillRect(previewOffsetX + x * pCell, previewOffsetY + y * pCell, pCell, pCell);
                } else {
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius * 1.1, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        });
        
        // Highlight Current Partition
        const hx = previewOffsetX + startX * pCell;
        const hy = previewOffsetY + startY * pCell;
        const hw = blockSize * pCell;
        const hh = blockSize * pCell;

        ctx.strokeStyle = cHighlightDash;
        ctx.lineWidth = 3;
        ctx.strokeRect(hx, hy, hw, hh);
        ctx.strokeStyle = cHighlightSolid;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(hx, hy, hw, hh);
        ctx.setLineDash([]);

        if (partitions > 1) {
            ctx.textAlign = 'center';
            ctx.font = '300 32px "JetBrains Mono"';
            ctx.fillStyle = cText;
            ctx.fillText(t.partitionLabel(label), labelPos.x, labelPos.y);
        }

        // --- 3. BOM (Material List) ---
        
        const localCounts = countColors(sheetGrid); 
        
        if (localCounts.length > 0) {
            const count = localCounts.length;
            let bestConfig = { cols: 1, itemH: 10, totalScore: 0 };
            
            // BOM Area Constraints
            const gapX = 16;
            const gapY = 24;
            const maxItemCap = 140;

            const maxCheckCols = 8;

            for (let cols = 1; cols <= maxCheckCols; cols++) {
                 const rows = Math.ceil(count / cols);
                 
                 // Available space calculation
                 const availableW = bomRect.w - (cols - 1) * gapX;
                 const availableH = bomRect.h - (rows - 1) * gapY;
                 
                 if (availableW <= 0 || availableH <= 0) continue;

                 const slotW = availableW / cols;
                 const slotH = availableH / rows;
                 
                 if (slotW < 60) continue; 

                 // Constraint: Aspect ratio of item
                 const maxH_byWidth = slotW / 4.0;
                 
                 const h = Math.min(slotH, maxH_byWidth, maxItemCap);
                 
                 let score = h;
                 if (score > bestConfig.itemH + 2) {
                     bestConfig = { cols, itemH: h, totalScore: score };
                 } 
            }
            
            // Final Render
            const itemH = bestConfig.itemH;
            const cols = bestConfig.cols;
            const slotW = (bomRect.w - (cols - 1) * gapX) / cols;

            localCounts.forEach((c, idx) => {
                const colIdx = idx % cols;
                const rowIdx = Math.floor(idx / cols);
                
                const ix = bomRect.x + colIdx * (slotW + gapX);
                const iy = bomRect.y + rowIdx * (itemH + gapY);
                
                // Draw Icon
                const radius = itemH / 2;
                const cx = ix + radius;
                const cy = iy + radius;
                
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fillStyle = c.hex;
                ctx.fill();
                
                // Color Code in Circle
                if (itemH >= 20) {
                    const rgb = parseInt(c.hex.replace('#', ''), 16);
                    const b = ((rgb >> 16) & 0xff) * 0.299 + ((rgb >> 8) & 0xff) * 0.587 + (rgb & 0xff) * 0.114;
                    ctx.fillStyle = b > 140 ? '#000' : '#fff';
                    ctx.font = `300 ${Math.floor(itemH * 0.35)}px "JetBrains Mono"`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(c.code, cx, cy);
                }

                // Count Text
                ctx.fillStyle = cText;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const fontSize = Math.floor(itemH * 0.45);
                ctx.font = `300 ${fontSize}px "JetBrains Mono"`; 
                
                const textX = ix + (radius * 2) + (itemH * 0.2);
                ctx.fillText(`x${c.count}`, textX, cy);
            });
        }
    }

    ctx.fillStyle = isDark ? '#666' : '#999';
    ctx.font = '300 28px "Inter", sans-serif';
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'bottom';
    ctx.fillText(t.brandName, width / 2, height - 30);

  }, [t]);


  // --- Render to Screen Canvas ---
  useEffect(() => {
    if (isProcessing) return;

    const canvas = canvasRef.current;
    if (!canvas || !finalGrid.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseW = layoutRatio === '3:4' ? 2400 : 3200; 
    const baseH = layoutRatio === '3:4' ? 3200 : 2400;

    canvas.width = baseW;
    canvas.height = baseH;

    drawBlueprintSheet(
        ctx, 
        currentSheet, 
        finalGrid, 
        resolution, 
        partitions, 
        layoutRatio, 
        baseW, 
        baseH,
        showGridLines,
        pageMargin * 2, 
        resolvedTheme === 'dark'
    );

  }, [finalGrid, currentSheet, resolution, partitions, layoutRatio, showGridLines, pageMargin, drawBlueprintSheet, resolvedTheme, isProcessing]);


  // --- Download Handler ---
  const handleDownloadClick = () => {
     setShowDownloadModal(true);
  };

  const processDownload = async (filename: string, format: 'jpeg' | 'png' | 'pdf') => {
    setShowDownloadModal(false);
    if (!finalGrid.length || !file) return;
    
    // Save filename for later
    if (filename.trim()) {
        setStoredFilename(filename);
    }
    
    // Default name
    const finalName = filename.trim() || `beadprint_${Date.now()}`;

    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 100)); // allow UI to update

    try {
        const isPortrait = layoutRatio === '3:4';
        const width = isPortrait ? 2400 : 3200;
        const height = isPortrait ? 3200 : 2400;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const isDark = resolvedTheme === 'dark';
        const totalSheets = partitions * partitions;
        const scaledMargin = pageMargin * 2;

        if (!ctx) throw new Error("Context creation failed");

        if (format === 'pdf') {
            // PDF Generation
            const orientation = isPortrait ? 'p' : 'l';
            const pdf = new jsPDF({
                orientation: orientation,
                unit: 'px',
                format: [width, height],
                compress: true
            });

            for (let i = 0; i < totalSheets; i++) {
                if (i > 0) pdf.addPage([width, height], orientation);
                
                // Clear and Draw
                ctx.clearRect(0,0, width, height);
                drawBlueprintSheet(ctx, i, finalGrid, resolution, partitions, layoutRatio, width, height, showGridLines, scaledMargin, isDark);
                
                const imgData = canvas.toDataURL('image/jpeg', 0.85);
                pdf.addImage(imgData, 'JPEG', 0, 0, width, height);
            }
            
            pdf.save(`${finalName}.pdf`);

        } else {
            // Image Generation (PNG/JPEG)
            const zip = new JSZip();
            const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
            const ext = format;

            if (totalSheets === 1) {
                drawBlueprintSheet(ctx, 0, finalGrid, resolution, partitions, layoutRatio, width, height, showGridLines, scaledMargin, isDark);
                
                const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, mimeType, 0.9));
                if (blob) downloadFile(blob, `${finalName}.${ext}`);

            } else {
                for (let i = 0; i < totalSheets; i++) {
                    const label = getPartitionLabel(i, partitions);
                    ctx.clearRect(0,0, width, height);
                    drawBlueprintSheet(ctx, i, finalGrid, resolution, partitions, layoutRatio, width, height, showGridLines, scaledMargin, isDark);
                    
                    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, mimeType, 0.9));
                    if (blob) zip.file(`${finalName}_${label}.${ext}`, blob);
                }
                const content = await zip.generateAsync({ type: 'blob' });
                downloadFile(content, `${finalName}.zip`);
            }
        }

    } catch(e) {
        console.error("Download failed", e);
    } finally {
        setIsProcessing(false);
    }
  };


  // --- Zoom/Pan Events ---
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scaleAmount = -e.deltaY * 0.0005;
    const newScale = Math.min(Math.max(0.05, viewTransform.scale + scaleAmount), 2);
    setViewTransform(prev => ({ ...prev, scale: newScale }));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - viewTransform.x, y: e.clientY - viewTransform.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setViewTransform(prev => ({
        ...prev,
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y
    }));
  };

  const handleMouseUp = () => setIsDragging(false);

  // --- Render ---
  return (
    <div className="flex h-screen w-full flex-col md:flex-row bg-neutral-50 dark:bg-black text-neutral-900 dark:text-neutral-100 overflow-hidden">
      
      {/* --- Left Panel: Workflow --- */}
      <aside className="w-full md:w-80 border-r dark:border-neutral-800 flex flex-col bg-white dark:bg-neutral-900 z-10 shadow-lg shrink-0">
        <div className="p-4 border-b dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Grid className="w-6 h-6" />
            <h1 className="font-bold text-lg tracking-tight">{t.appTitle}</h1>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-thin">
          
          {/* Upload */}
          <section className="space-y-3">
             <div className="flex justify-between items-baseline">
                <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">{t.source}</h2>
                <span className="text-[10px] text-neutral-400">
                  {file ? t.clickToChange : 'Tap to Upload'}
                </span>
             </div>
             
             {/* Upload Trigger Area */}
             <div 
               onClick={() => fileInputRef.current?.click()}
               className="w-full aspect-square bg-neutral-100 dark:bg-neutral-800 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 mb-1 relative group flex items-center justify-center cursor-pointer hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
             >
               {(previewSrc || file) ? (
                 <img src={previewSrc || file || ''} alt="Source" className="w-full h-full object-contain" />
               ) : (
                 <div className="flex flex-col items-center gap-2 text-neutral-400">
                   <Upload className="w-10 h-10" />
                   <span className="text-xs font-medium">Upload Image</span>
                 </div>
               )}
               
               {/* Hover Overlay */}
               <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 dark:group-hover:bg-white/5 transition-colors" />
               
               <input 
                  ref={fileInputRef}
                  type="file" 
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                />
             </div>
          </section>

          {/* Settings */}
          <section className="space-y-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">{t.config}</h2>
            
            <div>
                <label className="text-xs font-medium mb-2 block">{t.preset}</label>
                <select 
                    className="w-full bg-neutral-100 dark:bg-neutral-800 border-none rounded p-2 text-sm focus:ring-1 focus:ring-slate-500"
                    value={selectedPreset}
                    onChange={(e) => setSelectedPreset(e.target.value)}
                >
                    {Object.keys(COLOR_PRESETS).map((key) => {
                        const p = COLOR_PRESETS[key];
                        return (
                            <option key={key} value={key}>
                                {lang === 'en' && p.name_en ? p.name_en : p.name}
                            </option>
                        );
                    })}
                </select>
                <p className="text-[10px] text-neutral-400 mt-1">
                    {lang === 'en' && COLOR_PRESETS[selectedPreset].description_en 
                        ? COLOR_PRESETS[selectedPreset].description_en 
                        : COLOR_PRESETS[selectedPreset].description}
                </p>
            </div>

            <Slider 
                label={t.resolution}
                min={8} max={48} 
                value={uiResolution} 
                onChange={setUiResolution}
                onCommit={setResolution}
            />
            
            <Slider 
                label={t.partitions} 
                min={1} max={8} 
                value={uiPartitions} 
                onChange={setUiPartitions}
                onCommit={setPartitions}
            />
            
            {/* Outline Controls */}
            <div className="space-y-2 pt-2 border-t border-dashed border-neutral-200 dark:border-neutral-800">
              <Slider 
                  label={t.outlineWidth}
                  min={0} max={5} 
                  value={outlineWidth}
                  onChange={setOutlineWidth}
              />
              {outlineWidth > 0 && (
                <div className="flex items-center justify-between">
                   <label className="text-xs text-neutral-500">{t.outlineColor}</label>
                   <select 
                     value={outlineColor}
                     onChange={(e) => setOutlineColor(e.target.value)}
                     className="bg-neutral-100 dark:bg-neutral-800 text-xs p-1 rounded w-24 border-none text-right font-mono"
                   >
                     {/* Show Common options first, then all */}
                     <option value="H1">H1 (White)</option>
                     <option value="H7">H7 (Black)</option>
                     <option disabled>──────</option>
                     {Object.keys(MARD_COLORS).sort().map(code => (
                       <option key={code} value={code}>{code}</option>
                     ))}
                   </select>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-dashed border-neutral-200 dark:border-neutral-800">
                <label className="text-xs font-medium text-gray-500 uppercase">{t.layout}</label>
                <div className="flex bg-neutral-100 dark:bg-neutral-800 p-1 rounded">
                    <button 
                        onClick={() => setLayoutRatio('3:4')}
                        className={`flex-1 flex items-center justify-center py-1 rounded text-xs font-medium transition-all ${layoutRatio === '3:4' ? 'bg-white dark:bg-neutral-700 shadow-sm' : 'text-neutral-500'}`}
                    >
                        {t.portrait}
                    </button>
                    <button 
                        onClick={() => setLayoutRatio('4:3')}
                        className={`flex-1 flex items-center justify-center py-1 rounded text-xs font-medium transition-all ${layoutRatio === '4:3' ? 'bg-white dark:bg-neutral-700 shadow-sm' : 'text-neutral-500'}`}
                    >
                        {t.landscape}
                    </button>
                </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-gray-500 uppercase">{t.showGrid}</label>
                  <button onClick={() => setShowGridLines(!showGridLines)} className="text-slate-900 dark:text-slate-100">
                      {showGridLines ? <ToggleRight className="w-6 h-6"/> : <ToggleLeft className="w-6 h-6 text-gray-400"/>}
                  </button>
              </div>

              <Slider 
                  label={t.marginSetting}
                  min={60} max={120}
                  value={pageMargin}
                  onChange={setPageMargin}
              />
            </div>
          </section>
        </div>

        <div className="p-4 border-t dark:border-neutral-800">
             <Button 
                className="w-full h-12 text-lg" 
                onClick={handleDownloadClick}
                disabled={!finalGrid.length || isProcessing}
             >
                {isProcessing ? <Loader2 className="animate-spin mr-2"/> : <Download className="w-5 h-5 mr-2" />}
                {t.download}
             </Button>
        </div>
      </aside>

      {/* --- Center Panel: Canvas Viewport --- */}
      <main ref={mainRef} className="flex-1 relative bg-neutral-200 dark:bg-neutral-950 flex flex-col overflow-hidden">
         {/* Loading Overlay */}
         {isProcessing && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-lg shadow-xl flex flex-col items-center">
                    <Loader2 className="w-8 h-8 animate-spin mb-2" />
                    <span className="text-sm font-medium">Processing...</span>
                </div>
            </div>
         )}

         {/* Partition Selector (Top) */}
         <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
            {partitions > 1 && (
                <PartitionPreview 
                    count={partitions} 
                    currentSheet={currentSheet} 
                    onSelect={setCurrentSheet}
                />
            )}
         </div>

        <div 
            className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* Background Grid */}
            <div className="absolute inset-0 opacity-10 pointer-events-none" 
                 style={{ 
                    backgroundImage: 'radial-gradient(circle, #888 1px, transparent 1px)', 
                    backgroundSize: '20px 20px',
                    transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
                    transformOrigin: '0 0'
                 }} 
            />
            
            {/* Canvas Container */}
            <div 
                className="absolute top-1/2 left-1/2 origin-center shadow-2xl bg-white dark:bg-black transition-opacity duration-500"
                style={{
                    transform: `translate(-50%, -50%) translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
                    opacity: finalGrid.length > 0 ? 1 : 0
                }}
            >
                {finalGrid.length > 0 && <canvas ref={canvasRef} className="block" />}
            </div>
            
            {/* Empty State Overlay */}
            {!finalGrid.length && !isProcessing && (
               <div className="absolute inset-0 flex items-center justify-center flex-col text-neutral-400 pointer-events-none">
                    <Grid className="w-16 h-16 opacity-20 mb-4" />
                    <p>{t.emptyState}</p>
               </div>
            )}
        </div>

        {/* Canvas Controls (Bottom) */}
        {finalGrid.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
              <div className="flex items-center gap-2 bg-white/80 dark:bg-black/80 backdrop-blur rounded-full px-4 py-2 shadow-sm border dark:border-neutral-800">
                  <button onClick={() => setViewTransform(p => ({...p, scale: Math.max(0.05, p.scale - 0.05)}))}><ZoomOut className="w-4 h-4"/></button>
                  <span className="text-xs w-12 text-center">{Math.round(viewTransform.scale * 100)}%</span>
                  <button onClick={() => setViewTransform(p => ({...p, scale: p.scale + 0.05}))}><ZoomIn className="w-4 h-4"/></button>
                  <button onClick={handleFitView} className="ml-2 text-xs uppercase font-bold text-gray-500 flex items-center gap-1">
                      <Maximize className="w-3 h-3"/> Fit
                  </button>
              </div>
          </div>
        )}
      </main>

      {/* --- Right Panel: Data & Tools --- */}
      <aside className="w-full md:w-80 border-l dark:border-neutral-800 flex flex-col bg-white dark:bg-neutral-900 z-10 shadow-lg shrink-0">
        {/* Header Tools */}
        <div className="p-4 border-b dark:border-neutral-800 flex justify-end items-center gap-4">
             {/* Lang Switch */}
             <button onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')} className="flex items-center gap-1 text-xs font-bold hover:text-slate-600">
                <Languages className="w-4 h-4" /> {lang === 'en' ? 'EN' : '中文'}
             </button>

             {/* Theme Switch */}
             <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
                <button onClick={() => setTheme('light')} className={`p-1.5 rounded ${theme === 'light' ? 'bg-white dark:bg-neutral-600 shadow' : 'text-gray-400'}`}><Sun className="w-3 h-3"/></button>
                <button onClick={() => setTheme('dark')} className={`p-1.5 rounded ${theme === 'dark' ? 'bg-white dark:bg-neutral-600 shadow' : 'text-gray-400'}`}><Moon className="w-3 h-3"/></button>
                <button onClick={() => setTheme('system')} className={`p-1.5 rounded ${theme === 'system' ? 'bg-white dark:bg-neutral-600 shadow' : 'text-gray-400'}`}><Monitor className="w-3 h-3"/></button>
             </div>
        </div>

        {/* Color Management */}
        <div className="flex-1 overflow-y-auto flex flex-col scrollbar-thin">
            <div className="p-4 border-b dark:border-neutral-800 space-y-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">{t.colorReduction}</h2>
                <div className="space-y-2">
                    <Slider 
                        label={`${t.maxColors}: ${uiMaxColors}`}
                        min={2} 
                        max={availableColorCount} 
                        value={uiMaxColors}
                        onChange={setUiMaxColors}
                        onCommit={setMaxColors}
                        disabled={!finalGrid.length}
                    />
                    <p className="text-[10px] text-neutral-500 leading-tight">
                        {t.usedColorsSub(uiMaxColors)}
                    </p>
                </div>
            </div>

            <div className="flex-1 p-4">
                <div className="mb-4">
                     <div>
                        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                            {t.usedColors} ({currentColors.length})
                        </h2>
                        <p className="text-[10px] text-neutral-400 mt-0.5">{t.colorHint}</p>
                     </div>
                </div>
                
                {/* Merge Tool Block */}
                <div className="mb-4 space-y-3">
                   <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <Slider 
                                label={`${t.mergeThreshold}: ${mergeThreshold}`}
                                min={1} 
                                max={20} 
                                value={mergeThreshold} 
                                onChange={setMergeThreshold}
                                disabled={!finalGrid.length}
                            />
                        </div>
                        <Button 
                            size="sm"
                            onClick={handleMergeSmallColors}
                            disabled={!finalGrid.length}
                            title={`Merge all colors with count < ${mergeThreshold}`}
                        >
                            <PaintBucket className="w-3 h-3 mr-1" />
                            {t.mergeSmall}
                        </Button>
                   </div>
                </div>
                
                <div className="space-y-1">
                    {currentColors.map((color) => (
                        <button 
                            key={color.code}
                            onClick={() => handleOneClickMerge(color.code)}
                            title="Click to merge into nearest color"
                            className="w-full group flex items-center justify-between p-2 rounded text-sm transition-all border border-transparent hover:bg-red-50 hover:border-red-100 dark:hover:bg-red-900/20 dark:hover:border-red-900/30"
                        >
                            <div className="flex items-center gap-3">
                                <ColorDot hex={color.hex} />
                                <span className="font-mono font-medium">{color.code}</span>
                            </div>
                            <span className="text-neutral-400 font-mono text-xs">{color.count}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
      </aside>

      {/* Modals */}
      {showCropper && tempFile && (
        <CropperModal 
            imageSrc={tempFile} 
            onCancel={handleCropperCancel}
            onCropComplete={handleCropperConfirm}
            labels={{
                title: t.cropperTitle,
                hint: t.cropperHint,
                zoom: t.zoom,
                cancel: t.cancel,
                confirm: t.confirm,
            }}
        />
      )}
      
      <DownloadModal 
          isOpen={showDownloadModal}
          onClose={() => setShowDownloadModal(false)}
          onConfirm={processDownload}
          initialName={storedFilename}
          labels={{
              title: t.downloadSettings,
              filename: t.filename,
              placeholder: t.enterFilename,
              format: t.fileFormat,
              cancel: t.cancel,
              download: t.download
          }}
      />
    </div>
  );
}