'use client';

import { useEffect } from 'react';

interface FullMessageModalProps {
  body: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function FullMessageModal({
  body,
  isOpen,
  onClose
}: FullMessageModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleEscapeKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscapeKeyDown);

    return () => {
      window.removeEventListener('keydown', handleEscapeKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-8 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Full message"
        className="w-full max-w-2xl rounded-[2rem] border border-white/60 bg-[#f7f2eb] p-6 shadow-2xl md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
              Message detail
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl font-semibold text-slatewarm-950">
              Full message
            </h2>
            <p className="max-w-lg text-sm leading-6 text-slate-600">
              Full stored message body with preserved line breaks.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white text-lg text-slate-700 transition-colors duration-200 hover:border-slatewarm-950 hover:text-slatewarm-950"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-stone-200 bg-white px-5 py-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">
            {body}
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex rounded-full border border-stone-300 bg-white px-5 py-2 text-sm font-medium text-slatewarm-950 transition-colors duration-200 hover:border-slatewarm-950 hover:bg-stone-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
