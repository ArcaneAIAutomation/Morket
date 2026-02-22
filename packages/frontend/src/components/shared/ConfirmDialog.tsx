import { useState } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');
  if (!open) return null;

  const canConfirm = confirmText ? inputValue === confirmText : true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 id="confirm-title" className="text-lg font-semibold mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        {confirmText && (
          <input
            type="text"
            className="w-full border rounded px-3 py-2 text-sm mb-4"
            placeholder={`Type "${confirmText}" to confirm`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            aria-label="Confirmation input"
          />
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => { onConfirm(); setInputValue(''); }}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
