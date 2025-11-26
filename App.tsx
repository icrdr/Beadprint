import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Upload, Download, Grid, Sun, Moon, Monitor, RefreshCw, Languages, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, ToggleLeft, ToggleRight, Loader2, Maximize, Image as ImageIcon, PaintBucket, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings, Palette, X } from 'lucide-react';
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
                className={`flex w-6 h-6 items-center justify-center text-[10px] font-mono font-bold transition-all
                  ${isActive 
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black scale-110 shadow-sm' 
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
  
  // Canvas Viewport State - Start at 35%
  const [viewTransform, setViewTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 0.35 }); 
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Touch Gesture State
  const touchStartDist = useRef<number | null>(null);
  const touchStartCenter = useRef<{x: number, y: number} | null>(null);
  const initialViewTransform = useRef<ViewTransform>({ x: 0, y: 0, scale: 1 });

  // Sidebar States (Mobile Only Overlays)
  const [isMobileLeftOpen, setIsMobileLeftOpen] = useState(false);
  const [isMobileRightOpen, setIsMobileRightOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t = UI_TEXT[lang];

  // --- Effects ---

  // Initialize Responsive State
  useEffect(() => {
    const handleResize = () => {
        // Breakpoint changed to lg (1024px)
        const mobile = window.innerWidth < 1024;
        setIsMobile(mobile);
        if (!mobile) {
            // Reset mobile overlays when switching to desktop
            setIsMobileLeftOpen(false);
            setIsMobileRightOpen(false);
        }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
  useEffect(() => {
    if (grid.length === 0) return;
    
    const runOptimization = async () => {
        const reduced = reduceColorsSmart(grid, maxColors);
        const outlined = applyOutline(reduced, outlineWidth, outlineColor);
        setFinalGrid(outlined);
    };
    runOptimization();

  }, [grid, maxColors, outlineWidth, outlineColor]);

  // Auto-fit view when a new final grid is first generated
  useEffect(() => {
    if (finalGrid.length > 0 && !isProcessing) {
        if (viewTransform.scale === 0.35) { // Check if still default
            handleFitView();
        }
    }
  }, [finalGrid]);

  useEffect(() => {
    setCurrentSheet(0);
  }, [partitions]);

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
      processFile(e.target.files[0]);
    }
  };

  const processFile = (fileObj: File) => {
      setPreviewSrc(null);
      const reader = new FileReader();
      reader.onload = () => {
        setTempFile(reader.result as string);
        setShowCropper(true);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(fileObj);
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const droppedFile = e.dataTransfer.files[0];
          if (droppedFile.type.startsWith('image/')) {
              processFile(droppedFile);
          }
      }
  };

  const handleCropperCancel = () => {
      setTempFile(null);
      setShowCropper(false);
  };

  const handleCropperConfirm = (imgSrc: string, pixelData: any) => {
      if (!pixelData) return;

      // Reset Settings
      setResolution(24);
      setUiResolution(24);
      setPartitions(1);
      setUiPartitions(1);
      setMaxColors(64);
      setUiMaxColors(64);
      setOutlineWidth(1); 
      setStoredFilename('');

      if (tempFile) setFile(tempFile);
      setCroppedPixelData(pixelData);
      setTempFile(null);
      setShowCropper(false);
      
      // Close overlays on mobile
      setIsMobileLeftOpen(false);
      setIsMobileRightOpen(false);
  };

  const toggleMobileLeft = () => {
     const newState = !isMobileLeftOpen;
     setIsMobileLeftOpen(newState);
     if (newState) setIsMobileRightOpen(false);
  };

  const toggleMobileRight = () => {
     const newState = !isMobileRightOpen;
     setIsMobileRightOpen(newState);
     if (newState) setIsMobileLeftOpen(false);
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
    // Account for mobile header/footer if visible?
    // mainRef size handles it usually, but let's be safe
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

  // --- Touch Gestures Helpers ---
  const getDistance = (touches: TouchList) => {
      return Math.sqrt(
          Math.pow(touches[0].clientX - touches[1].clientX, 2) +
          Math.pow(touches[0].clientY - touches[1].clientY, 2)
      );
  };

  const getCenter = (touches: TouchList) => {
      return {
          x: (touches[0].clientX + touches[1].clientX) / 2,
          y: (touches[0].clientY + touches[1].clientY) / 2
      };
  };

  const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
          touchStartCenter.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          initialViewTransform.current = { ...viewTransform };
      } else if (e.touches.length === 2) {
          const d = getDistance(e.touches);
          const c = getCenter(e.touches);
          touchStartDist.current = d;
          touchStartCenter.current = c;
          initialViewTransform.current = { ...viewTransform };
      }
  };

  const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Prevent scrolling
      if (e.touches.length === 1 && touchStartCenter.current) {
          const dx = e.touches[0].clientX - touchStartCenter.current.x;
          const dy = e.touches[0].clientY - touchStartCenter.current.y;
          setViewTransform(prev => ({
              ...prev,
              x: initialViewTransform.current.x + dx,
              y: initialViewTransform.current.y + dy
          }));
      } else if (e.touches.length === 2 && touchStartDist.current && touchStartCenter.current) {
          const currentDist = getDistance(e.touches);
          const currentCenter = getCenter(e.touches);
          
          const scaleFactor = currentDist / touchStartDist.current;
          const newScale = Math.min(Math.max(0.05, initialViewTransform.current.scale * scaleFactor), 4);
          
          const dx = currentCenter.x - touchStartCenter.current.x;
          const dy = currentCenter.y - touchStartCenter.current.y;

          setViewTransform({
              x: initialViewTransform.current.x + dx,
              y: initialViewTransform.current.y + dy,
              scale: newScale
          });
      }
  };
  
  const handleTouchEnd = (e: TouchEvent) => {
      // Clean up ref if needed, usually just reset dist
      if (e.touches.length === 0) {
        touchStartDist.current = null;
        touchStartCenter.current = null;
      }
  }

  // Effect to attach non-passive listeners
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
        el.removeEventListener('touchstart', handleTouchStart);
        el.removeEventListener('touchmove', handleTouchMove);
        el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [viewTransform]); // Re-attach when view state changes so refs are current

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

    ctx.fillStyle = cBg;
    ctx.fillRect(0, 0, width, height);
    
    const rulerOffset = 40; 
    const safeW = width - (2 * margin);
    const safeH = height - (2 * margin);

    let gridRect, previewRect, bomRect, labelPos;

    if (isPortrait) {
        const contentGap = 120;
        const maxGridH = (safeH - contentGap - 100) * 0.75; 
        const gridSize = Math.floor(Math.min(safeW, maxGridH));
        const previewSize = gridSize / 3; 
        
        // Centered Grid
        gridRect = {
            x: margin + (safeW - gridSize) / 2,
            y: margin,
            w: gridSize,
            h: gridSize
        };

        const bottomY = margin + gridSize + contentGap;
        
        // Calculate Content Block width at bottom (Preview + Gap + BOM) to center it
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
        const contentGap = 60; 
        
        const gByW = (safeW - contentGap) * 0.75;
        const gByH = safeH;
        
        const finalGridSize = Math.floor(Math.min(gByW, gByH));
        const finalPreviewSize = finalGridSize / 3;
        
        const totalContentW = finalGridSize + contentGap + finalPreviewSize;
        const totalContentH = finalGridSize; 
        
        // Center vertically and horizontally
        const startX = margin + (safeW - totalContentW) / 2;
        const startY = margin + (safeH - totalContentH) / 2;
        
        gridRect = {
            x: startX,
            y: startY,
            w: finalGridSize,
            h: finalGridSize
        };

        const sidebarX = startX + finalGridSize + contentGap;

        // Preview top aligned with grid top
        previewRect = {
            x: sidebarX,
            y: startY,
            w: finalPreviewSize,
            h: finalPreviewSize
        };
        
        labelPos = {
            x: previewRect.x + finalPreviewSize / 2,
            y: previewRect.y + finalPreviewSize + 40
        };
        
        const bomY = labelPos.y + 60;
        // BOM width matches Preview Width exactly
        bomRect = {
            x: sidebarX,
            y: bomY,
            w: finalPreviewSize, 
            h: (startY + finalGridSize) - bomY
        };
    }

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

        sheetGrid.forEach((row, y) => {
            row.forEach((pixel, x) => {
                const cx = offsetX + x * cellSize;
                const cy = offsetY + y * cellSize;
                
                if (showGrid) {
                    ctx.strokeStyle = cGrid;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(cx, cy, cellSize, cellSize);
                }

                if (!pixel) return; 

                ctx.fillStyle = pixel.hex;
                ctx.fillRect(cx, cy, cellSize, cellSize);
                
                ctx.strokeStyle = showGrid ? cGrid : cGridStroke;
                ctx.lineWidth = 1;
                ctx.strokeRect(cx, cy, cellSize, cellSize);

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

        const localCounts = countColors(sheetGrid); 
        
        if (localCounts.length > 0) {
            const count = localCounts.length;
            let bestConfig = { cols: 1, itemH: 10, totalScore: 0 };
            
            const gapX = 8;
            const gapY = 24;
            const maxItemCap = 140;

            const maxCheckCols = isPortrait ? 6 : 4; 

            for (let cols = 1; cols <= maxCheckCols; cols++) {
                 const rows = Math.ceil(count / cols);
                 const availableW = bomRect.w - (cols - 1) * gapX;
                 const availableH = bomRect.h - (rows - 1) * gapY;
                 
                 if (availableW <= 0 || availableH <= 0) continue;

                 const slotW = availableW / cols;
                 const slotH = availableH / rows;
                 
                 if (slotW < 60) continue; 

                 const maxH_byWidth = slotW / 4.0;
                 const h = Math.min(slotH, maxH_byWidth, maxItemCap);
                 let score = h;
                 
                 // Heuristic
                 if (score > bestConfig.itemH + 2) {
                     bestConfig = { cols, itemH: h, totalScore: score };
                 } 
            }
            
            const itemH = bestConfig.itemH;
            const cols = bestConfig.cols;
            const slotW = (bomRect.w - (cols - 1) * gapX) / cols;

            localCounts.forEach((c, idx) => {
                const colIdx = idx % cols;
                const rowIdx = Math.floor(idx / cols);
                
                const ix = bomRect.x + colIdx * (slotW + gapX);
                const iy = bomRect.y + rowIdx * (itemH + gapY);
                
                const radius = itemH / 2;
                const cx = ix + radius;
                const cy = iy + radius;
                
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fillStyle = c.hex;
                ctx.fill();
                
                if (itemH >= 20) {
                    const rgb = parseInt(c.hex.replace('#', ''), 16);
                    const b = ((rgb >> 16) & 0xff) * 0.299 + ((rgb >> 8) & 0xff) * 0.587 + (rgb & 0xff) * 0.114;
                    ctx.fillStyle = b > 140 ? '#000' : '#fff';
                    ctx.font = `300 ${Math.floor(itemH * 0.35)}px "JetBrains Mono"`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(c.code, cx, cy);
                }

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


  const handleDownloadClick = () => {
     setShowDownloadModal(true);
  };

  const processDownload = async (filename: string, format: 'jpeg' | 'png' | 'pdf') => {
    setShowDownloadModal(false);
    if (!finalGrid.length || !file) return;
    if (filename.trim()) {
        setStoredFilename(filename);
    }
    const finalName = filename.trim() || `beadprint_${Date.now()}`;
    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 100));

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
            const orientation = isPortrait ? 'p' : 'l';
            const pdf = new jsPDF({
                orientation: orientation,
                unit: 'px',
                format: [width, height],
                compress: true
            });

            for (let i = 0; i < totalSheets; i++) {
                if (i > 0) pdf.addPage([width, height], orientation);
                ctx.clearRect(0,0, width, height);
                drawBlueprintSheet(ctx, i, finalGrid, resolution, partitions, layoutRatio, width, height, showGridLines, scaledMargin, isDark);
                const imgData = canvas.toDataURL('image/jpeg', 0.85);
                pdf.addImage(imgData, 'JPEG', 0, 0, width, height);
            }
            pdf.save(`${finalName}.pdf`);
        } else {
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

  return (
    <div className="flex h-screen w-full flex-col lg:flex-row bg-neutral-50 dark:bg-black text-neutral-900 dark:text-neutral-100 overflow-hidden relative" onDragOver={handleDragOver} onDrop={handleDrop}>
      
      {/* --- Left Panel: Workflow --- */}
      <aside className={`
        fixed lg:relative inset-0 lg:inset-auto z-50 lg:z-auto
        flex flex-col bg-white dark:bg-neutral-900 shadow-lg shrink-0 transition-transform duration-300 ease-in-out border-r dark:border-neutral-800 overflow-hidden w-full lg:w-80
        ${isMobile 
            ? (isMobileLeftOpen ? 'translate-x-0' : '-translate-x-full') 
            : 'translate-x-0'
        }
      `}>
        <div className="p-4 border-b dark:border-neutral-800 flex items-center justify-between shrink-0 h-16">
          <div className="flex items-center gap-2">
            <Grid className="w-6 h-6" />
            <h1 className={`font-bold text-lg tracking-tight truncate ${isMobile ? 'hidden lg:block' : 'block'}`}>{t.appTitle}</h1>
          </div>
          <div className="flex gap-2">
            {/* Mobile close button */}
            <button onClick={() => setIsMobileLeftOpen(false)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded lg:hidden">
                <X className="w-6 h-6 text-neutral-500"/>
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-thin pb-20 lg:pb-4">
          <section className="space-y-3">
             <div className="flex justify-between items-baseline">
                <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">{t.source}</h2>
                <span className="text-[10px] text-neutral-400">
                  {file ? t.clickToChange : (isMobile ? t.tapToUpload : t.clickToUpload)}
                </span>
             </div>
             
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
               <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 dark:group-hover:bg-white/5 transition-colors" />
               <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect}/>
             </div>
          </section>

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
            <Slider label={t.resolution} min={8} max={48} value={uiResolution} onChange={setUiResolution} onCommit={setResolution} />
            <Slider label={t.partitions} min={1} max={8} value={uiPartitions} onChange={setUiPartitions} onCommit={setPartitions} />
            <div className="space-y-2 pt-2 border-t border-dashed border-neutral-200 dark:border-neutral-800">
              <Slider label={t.outlineWidth} min={0} max={5} value={outlineWidth} onChange={setOutlineWidth} />
              {outlineWidth > 0 && (
                <div className="flex items-center justify-between">
                   <label className="text-xs text-neutral-500">{t.outlineColor}</label>
                   <select value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)} className="bg-neutral-100 dark:bg-neutral-800 text-xs p-1 rounded w-24 border-none text-right font-mono">
                     <option value="H1">H1 (White)</option>
                     <option value="H7">H7 (Black)</option>
                     <option disabled>──────</option>
                     {Object.keys(MARD_COLORS).sort().map(code => (<option key={code} value={code}>{code}</option>))}
                   </select>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 pt-2 border-t border-dashed border-neutral-200 dark:border-neutral-800">
                <label className="text-xs font-medium text-gray-500 uppercase">{t.layout}</label>
                <div className="flex bg-neutral-100 dark:bg-neutral-800 p-1 rounded">
                    <button onClick={() => setLayoutRatio('3:4')} className={`flex-1 flex items-center justify-center py-1 rounded text-xs font-medium transition-all ${layoutRatio === '3:4' ? 'bg-white dark:bg-neutral-700 shadow-sm' : 'text-neutral-500'}`}>{t.portrait}</button>
                    <button onClick={() => setLayoutRatio('4:3')} className={`flex-1 flex items-center justify-center py-1 rounded text-xs font-medium transition-all ${layoutRatio === '4:3' ? 'bg-white dark:bg-neutral-700 shadow-sm' : 'text-neutral-500'}`}>{t.landscape}</button>
                </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-gray-500 uppercase">{t.showGrid}</label>
                  <button onClick={() => setShowGridLines(!showGridLines)} className="text-slate-900 dark:text-slate-100">
                      {showGridLines ? <ToggleRight className="w-6 h-6"/> : <ToggleLeft className="w-6 h-6 text-gray-400"/>}
                  </button>
              </div>
              <Slider label={t.marginSetting} min={60} max={120} value={pageMargin} onChange={setPageMargin} />
            </div>
          </section>
        </div>
        
        {/* Desktop Download Button (Visible lg+) */}
        <div className="p-4 border-t dark:border-neutral-800 shrink-0 hidden lg:block">
             <Button className="w-full h-12 text-lg" onClick={handleDownloadClick} disabled={!finalGrid.length || isProcessing}>
                {isProcessing ? <Loader2 className="animate-spin mr-2"/> : <Download className="w-5 h-5 mr-2" />}
                {t.download}
             </Button>
        </div>
      </aside>

      {/* --- Center Panel: Canvas Viewport --- */}
      <main ref={mainRef} className="flex-1 relative bg-neutral-200 dark:bg-neutral-950 flex flex-col overflow-hidden w-full h-full">
         
         {/* Mobile/Tablet Header Bar (< lg) */}
         <div className="lg:hidden absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-4 bg-white/80 dark:bg-neutral-900/80 backdrop-blur z-30 border-b dark:border-neutral-800">
             <h1 className="text-sm font-bold tracking-tight">{t.appTitle}</h1>
             <div className="flex items-center gap-2">
                 <button onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')} className="flex items-center justify-center p-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <Languages className="w-5 h-5" />
                 </button>
                 <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="flex items-center justify-center p-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    {theme === 'dark' ? <Sun className="w-5 h-5"/> : <Moon className="w-5 h-5"/>}
                 </button>
             </div>
         </div>

         {/* Mobile/Tablet Toggle Buttons (Floating) */}
         {isMobile && !isMobileLeftOpen && (
             <button onClick={toggleMobileLeft} className="absolute top-20 left-4 z-30 p-2 bg-white dark:bg-neutral-800 rounded shadow-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                <Settings className="w-5 h-5" />
             </button>
         )}
         {isMobile && !isMobileRightOpen && (
             <button onClick={toggleMobileRight} className="absolute top-20 right-4 z-30 p-2 bg-white dark:bg-neutral-800 rounded shadow-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                <Palette className="w-5 h-5" />
             </button>
         )}

         {/* Loading Overlay */}
         {isProcessing && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-lg shadow-xl flex flex-col items-center">
                    <Loader2 className="w-8 h-8 animate-spin mb-2" />
                    <span className="text-sm font-medium">Processing...</span>
                </div>
            </div>
         )}

         {/* Partition Selector */}
         <div className="absolute top-24 lg:top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
            {partitions > 1 && (
                <PartitionPreview count={partitions} currentSheet={currentSheet} onSelect={setCurrentSheet} />
            )}
         </div>

        <div 
            ref={canvasContainerRef}
            className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing pt-16 lg:pt-0 touch-none"
            style={{ touchAction: 'none' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <div className="absolute inset-0 opacity-10 pointer-events-none" 
                 style={{ 
                    backgroundImage: 'radial-gradient(circle, #888 1px, transparent 1px)', 
                    backgroundSize: '20px 20px',
                    transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
                    transformOrigin: '0 0'
                 }} 
            />
            <div 
                className="absolute top-1/2 left-1/2 origin-center shadow-2xl bg-white dark:bg-black transition-opacity duration-500"
                style={{
                    transform: `translate(-50%, -50%) translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
                    opacity: finalGrid.length > 0 ? 1 : 0
                }}
            >
                {finalGrid.length > 0 && <canvas ref={canvasRef} className="block" />}
            </div>
            
            {/* Empty State - Click to Upload */}
            {!finalGrid.length && !isProcessing && (
               <div 
                 onClick={() => fileInputRef.current?.click()}
                 className="absolute inset-0 flex items-center justify-center flex-col text-neutral-400 cursor-pointer hover:bg-neutral-50/50 dark:hover:bg-neutral-900/50 transition-colors"
               >
                    <Grid className="w-16 h-16 opacity-20 mb-4" />
                    <p>{t.emptyState}</p>
                    <p className="text-xs opacity-50 mt-2">{isMobile ? t.tapToUpload : t.clickToUpload}</p>
               </div>
            )}
        </div>
        
        {/* Mobile/Tablet Bottom Download Bar */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 p-4 bg-white dark:bg-neutral-900 border-t dark:border-neutral-800 z-40">
            <Button className="w-full h-12 text-lg shadow-lg" onClick={handleDownloadClick} disabled={!finalGrid.length || isProcessing}>
                {isProcessing ? <Loader2 className="animate-spin mr-2"/> : <Download className="w-5 h-5 mr-2" />}
                {t.download}
            </Button>
        </div>

        {finalGrid.length > 0 && (
          <div className="absolute bottom-20 lg:bottom-4 left-1/2 -translate-x-1/2 z-20">
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
      <aside className={`
        fixed lg:relative inset-0 lg:inset-auto z-50 lg:z-auto
        flex flex-col bg-white dark:bg-neutral-900 shadow-lg shrink-0 transition-transform duration-300 ease-in-out border-l dark:border-neutral-800 overflow-hidden w-full lg:w-80
        ${isMobile 
            ? (isMobileRightOpen ? 'translate-x-0' : 'translate-x-full') 
            : 'translate-x-0'
        }
      `}>
        <div className="p-4 border-b dark:border-neutral-800 flex justify-between items-center gap-4 shrink-0 h-16">
             <div className="flex gap-2">
                 {/* Mobile Close */}
                 <button onClick={() => setIsMobileRightOpen(false)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded lg:hidden">
                    <X className="w-6 h-6 text-neutral-500" />
                 </button>
             </div>

             {/* Desktop Lang/Theme Toggles (Hidden on Mobile) */}
             <div className="hidden lg:flex items-center gap-4">
                 <button onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')} className="flex items-center gap-1 text-xs font-bold hover:text-slate-600">
                    <Languages className="w-4 h-4" /> {lang === 'en' ? 'EN' : '中文'}
                 </button>
                 <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
                    <button onClick={() => setTheme('light')} className={`p-1.5 rounded ${theme === 'light' ? 'bg-white dark:bg-neutral-600 shadow' : 'text-gray-400'}`}><Sun className="w-3 h-3"/></button>
                    <button onClick={() => setTheme('dark')} className={`p-1.5 rounded ${theme === 'dark' ? 'bg-white dark:bg-neutral-600 shadow' : 'text-gray-400'}`}><Moon className="w-3 h-3"/></button>
                    <button onClick={() => setTheme('system')} className={`p-1.5 rounded ${theme === 'system' ? 'bg-white dark:bg-neutral-600 shadow' : 'text-gray-400'}`}><Monitor className="w-3 h-3"/></button>
                 </div>
             </div>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col scrollbar-thin pb-20 lg:pb-0">
            <div className="p-4 border-b dark:border-neutral-800 space-y-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">{t.colorReduction}</h2>
                <div className="space-y-2">
                    <Slider label={`${t.maxColors}: ${uiMaxColors}`} min={2} max={availableColorCount} value={uiMaxColors} onChange={setUiMaxColors} onCommit={setMaxColors} disabled={!finalGrid.length}/>
                    <p className="text-[10px] text-neutral-500 leading-tight">{t.usedColorsSub(uiMaxColors)}</p>
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
                
                <div className="mb-4 space-y-3">
                   <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <Slider label={`${t.mergeThreshold}: ${mergeThreshold}`} min={1} max={20} value={mergeThreshold} onChange={setMergeThreshold} disabled={!finalGrid.length}/>
                        </div>
                        <Button size="sm" onClick={handleMergeSmallColors} disabled={!finalGrid.length} title={`Merge all colors with count < ${mergeThreshold}`}>
                            <PaintBucket className="w-3 h-3 mr-1" />
                            {t.mergeSmall}
                        </Button>
                   </div>
                </div>
                
                <div className="space-y-1">
                    {currentColors.map((color) => (
                        <button key={color.code} onClick={() => handleOneClickMerge(color.code)} title="Click to merge into nearest color" className="w-full group flex items-center justify-between p-2 rounded text-sm transition-all border border-transparent hover:bg-red-50 hover:border-red-100 dark:hover:bg-red-900/20 dark:hover:border-red-900/30">
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

      {showCropper && tempFile && (
        <CropperModal 
            imageSrc={tempFile} 
            onCancel={handleCropperCancel}
            onCropComplete={handleCropperConfirm}
            labels={{ title: t.cropperTitle, hint: t.cropperHint, zoom: t.zoom, cancel: t.cancel, confirm: t.confirm }}
        />
      )}
      
      <DownloadModal isOpen={showDownloadModal} onClose={() => setShowDownloadModal(false)} onConfirm={processDownload} initialName={storedFilename} labels={{ title: t.downloadSettings, filename: t.filename, placeholder: t.enterFilename, format: t.fileFormat, cancel: t.cancel, download: t.download }} />
    </div>
  );
}