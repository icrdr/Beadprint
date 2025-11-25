import React, { useState, useEffect } from 'react';
import { Button } from './ui/Button';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (filename: string, format: 'jpeg' | 'png' | 'pdf') => void;
  initialName: string;
  labels: {
    title: string;
    filename: string;
    placeholder: string;
    format: string;
    cancel: string;
    download: string;
  };
}

export const DownloadModal: React.FC<DownloadModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialName,
  labels
}) => {
  const [name, setName] = useState(initialName);
  const [format, setFormat] = useState<'jpeg' | 'png' | 'pdf'>('jpeg');

  useEffect(() => {
    if (isOpen) {
        setName(initialName);
    }
  }, [isOpen, initialName]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b dark:border-neutral-800">
          <h3 className="font-bold text-lg">{labels.title}</h3>
        </div>
        
        <div className="p-6 space-y-6">
            <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-500 uppercase tracking-wider">{labels.filename}</label>
                <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={labels.placeholder}
                    className="w-full bg-neutral-100 dark:bg-neutral-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-slate-500 transition-all font-mono text-sm"
                    autoFocus
                />
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-500 uppercase tracking-wider">{labels.format}</label>
                <div className="grid grid-cols-3 gap-2">
                    {(['jpeg', 'png', 'pdf'] as const).map((fmt) => (
                        <button
                            key={fmt}
                            onClick={() => setFormat(fmt)}
                            className={`px-2 py-2 rounded text-sm font-mono uppercase transition-all border
                                ${format === fmt 
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-black border-transparent' 
                                    : 'bg-transparent text-neutral-500 border-neutral-200 dark:border-neutral-700 hover:border-slate-400'
                                }
                            `}
                        >
                            .{fmt}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        <div className="p-4 border-t dark:border-neutral-800 flex justify-end gap-2 bg-neutral-50 dark:bg-black/20">
             <Button variant="secondary" onClick={onClose}>{labels.cancel}</Button>
             <Button onClick={() => onConfirm(name, format)}>{labels.download}</Button> 
        </div>
      </div>
    </div>
  );
};