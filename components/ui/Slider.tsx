

import React from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  disabled?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
  label, value, min, max, step = 1, onChange, onCommit, disabled
}) => {
  const handleCommit = () => {
    if (onCommit) onCommit(value);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {label}
        </label>
        <input 
          type="number" 
          value={value} 
          min={min} 
          max={max}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val)) {
                const clamped = Math.max(min, Math.min(max, val));
                onChange(clamped);
                if (onCommit) onCommit(clamped);
            }
          }}
          disabled={disabled}
          className="w-12 h-6 text-right text-sm border-b border-gray-300 dark:border-gray-700 bg-transparent font-mono focus:outline-none focus:border-slate-500 transition-colors text-slate-900 dark:text-slate-100"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        onMouseUp={handleCommit}
        onTouchEnd={handleCommit}
        onKeyUp={(e) => {
             if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                 handleCommit();
             }
        }}
        disabled={disabled}
        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-slate-900 dark:accent-white"
      />
    </div>
  );
};