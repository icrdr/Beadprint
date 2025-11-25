
import React, { useState, useCallback, useRef, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { Button } from './ui/Button';

interface CropperModalProps {
  imageSrc: string;
  onCancel: () => void;
  onCropComplete: (croppedImage: string, cropData: any) => void;
  labels: {
    title: string;
    hint: string;
    zoom: string;
    cancel: string;
    confirm: string;
  };
}

export const CropperModal: React.FC<CropperModalProps> = ({ imageSrc, onCancel, onCropComplete, labels }) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [completedCrop, setCompletedCrop] = useState<any>(null);
  
  // State for visual guides
  const [snapState, setSnapState] = useState<{
      v: 'left' | 'center' | 'right' | null;
      h: 'top' | 'center' | 'bottom' | null;
  }>({ v: null, h: null });

  // Internal state for dimensions to calculate snapping
  const [mediaSize, setMediaSize] = useState<{width: number, height: number, naturalWidth: number, naturalHeight: number} | null>(null);
  const [containerSize, setContainerSize] = useState<{width: number, height: number} | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure container to determine actual Crop Size in pixels
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const onMediaLoaded = useCallback((mediaSize: any) => {
    setMediaSize(mediaSize);
  }, []);

  const onCropCompleteHandler = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCompletedCrop(croppedAreaPixels);
  }, []);

  // Custom Crop Change with Snapping
  const handleCropChange = useCallback((newCrop: { x: number, y: number }) => {
    if (!mediaSize || !containerSize) {
      setCrop(newCrop);
      return;
    }

    // Determine visual crop box size
    // react-easy-crop with aspect=1 creates a square crop area.
    // It takes the minimum dimension of the container.
    const cropBoxSize = Math.min(containerSize.width, containerSize.height);
    
    // Calculate current visual image size
    // At zoom=1 (contain), the image fits the cropBoxSize in its longest dimension.
    const fitScale = Math.min(cropBoxSize / mediaSize.naturalWidth, cropBoxSize / mediaSize.naturalHeight);
    const currentScale = fitScale * zoom;
    
    const imgW = mediaSize.naturalWidth * currentScale;
    const imgH = mediaSize.naturalHeight * currentScale;

    // Snapping Logic
    const SNAP_THRESHOLD = 15;
    let { x, y } = newCrop;
    let snappedV: 'left' | 'center' | 'right' | null = null;
    let snappedH: 'top' | 'center' | 'bottom' | null = null;

    // Snap Points (Relative to Center 0,0)
    // 1. Center Snap
    if (Math.abs(x) < SNAP_THRESHOLD) {
        x = 0;
        snappedV = 'center';
    }
    if (Math.abs(y) < SNAP_THRESHOLD) {
        y = 0;
        snappedH = 'center';
    }

    // 2. Edge Snap
    // Image Left Edge relative to center: x - imgW/2
    // Crop Left Edge relative to center: -cropBoxSize/2
    // Align: x - imgW/2 = -cropBoxSize/2  => x = (imgW - cropBoxSize) / 2
    
    // Left Align
    const snapX_Left = (imgW - cropBoxSize) / 2;
    // Right Align: Image Right Edge (x + imgW/2) = Crop Right Edge (cropBoxSize/2) => x = (cropBoxSize - imgW) / 2
    // Which is -snapX_Left
    const snapX_Right = -snapX_Left;
    
    const snapY_Top = (imgH - cropBoxSize) / 2;
    const snapY_Bottom = -snapY_Top;

    if (!snappedV) {
        if (Math.abs(x - snapX_Left) < SNAP_THRESHOLD) {
            x = snapX_Left;
            snappedV = 'left';
        }
        else if (Math.abs(x - snapX_Right) < SNAP_THRESHOLD) {
            x = snapX_Right;
            snappedV = 'right';
        }
    }

    if (!snappedH) {
        if (Math.abs(y - snapY_Top) < SNAP_THRESHOLD) {
            y = snapY_Top;
            snappedH = 'top';
        }
        else if (Math.abs(y - snapY_Bottom) < SNAP_THRESHOLD) {
            y = snapY_Bottom;
            snappedH = 'bottom';
        }
    }

    setCrop({ x, y });
    setSnapState({ v: snappedV, h: snappedH });

  }, [mediaSize, containerSize, zoom]);

  const handleConfirm = () => {
    if (completedCrop) {
      onCropComplete('', completedCrop);
    }
  };
  
  // Calculate style for guide lines
  const getGuideLines = () => {
      if (!containerSize) return null;
      const cropBoxSize = Math.min(containerSize.width, containerSize.height);
      const centerX = containerSize.width / 2;
      const centerY = containerSize.height / 2;
      const halfBox = cropBoxSize / 2;
      
      const guides = [];
      const color = 'rgba(56, 189, 248, 0.8)'; // Sky blue
      const width = '1px';
      
      // Vertical Lines
      if (snapState.v === 'center') {
          guides.push(<div key="v-c" className="absolute top-0 bottom-0 z-20 border-l border-dashed pointer-events-none" style={{ left: centerX, borderColor: color, borderWidth: width }} />);
      }
      if (snapState.v === 'left') {
          guides.push(<div key="v-l" className="absolute top-0 bottom-0 z-20 border-l border-dashed pointer-events-none" style={{ left: centerX - halfBox, borderColor: color, borderWidth: width }} />);
      }
      if (snapState.v === 'right') {
          guides.push(<div key="v-r" className="absolute top-0 bottom-0 z-20 border-l border-dashed pointer-events-none" style={{ left: centerX + halfBox, borderColor: color, borderWidth: width }} />);
      }

      // Horizontal Lines
      if (snapState.h === 'center') {
          guides.push(<div key="h-c" className="absolute left-0 right-0 z-20 border-t border-dashed pointer-events-none" style={{ top: centerY, borderColor: color, borderWidth: width }} />);
      }
      if (snapState.h === 'top') {
          guides.push(<div key="h-t" className="absolute left-0 right-0 z-20 border-t border-dashed pointer-events-none" style={{ top: centerY - halfBox, borderColor: color, borderWidth: width }} />);
      }
      if (snapState.h === 'bottom') {
          guides.push(<div key="h-b" className="absolute left-0 right-0 z-20 border-t border-dashed pointer-events-none" style={{ top: centerY + halfBox, borderColor: color, borderWidth: width }} />);
      }

      return guides;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 w-full max-w-2xl h-[80vh] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b dark:border-neutral-800 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-lg">{labels.title}</h3>
          <span className="text-xs text-gray-500">{labels.hint}</span>
        </div>
        
        <div ref={containerRef} className="relative flex-1 bg-neutral-100 dark:bg-black overflow-hidden relative group flex items-center justify-center">
          {getGuideLines()}
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            minZoom={0.5} 
            maxZoom={10}
            restrictPosition={false} 
            objectFit="contain"
            onCropChange={handleCropChange}
            onCropComplete={onCropCompleteHandler}
            onZoomChange={setZoom}
            onMediaLoaded={onMediaLoaded}
            showGrid={true}
            style={{
                containerStyle: { backgroundColor: 'transparent' },
                mediaStyle: { transition: 'none' } // smoother manual snapping
            }}
          />
        </div>

        <div className="p-4 border-t dark:border-neutral-800 flex justify-between items-center gap-4 bg-white dark:bg-neutral-900 shrink-0">
           <div className="flex-1">
             <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>0.5x</span>
                <span>{zoom.toFixed(1)}x</span>
                <span>10x</span>
             </div>
             <input
                type="range"
                value={zoom}
                min={0.5}
                max={10}
                step={0.1}
                aria-labelledby="Zoom"
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-slate-900"
              />
           </div>
           <div className="flex gap-2">
             <Button variant="secondary" onClick={onCancel}>{labels.cancel}</Button>
             <Button onClick={handleConfirm}>{labels.confirm}</Button> 
           </div>
        </div>
      </div>
    </div>
  );
};
