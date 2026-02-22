import { useEffect, useRef } from 'react';

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  visible: boolean;
  type: 'row' | 'column';
  onClose: () => void;
  onEnrichSelected?: () => void;
  onDeleteSelected?: () => void;
  onExportSelected?: () => void;
  onRenameColumn?: () => void;
  onChangeType?: () => void;
  onHideColumn?: () => void;
  onDeleteColumn?: () => void;
}

export default function ContextMenu({
  x,
  y,
  visible,
  type,
  onClose,
  onEnrichSelected,
  onDeleteSelected,
  onExportSelected,
  onRenameColumn,
  onChangeType,
  onHideColumn,
  onDeleteColumn,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const rowItems: ContextMenuAction[] = [
    { label: 'Enrich Selected', onClick: () => { onEnrichSelected?.(); onClose(); } },
    { label: 'Delete Selected', onClick: () => { onDeleteSelected?.(); onClose(); } },
    { label: 'Export Selected', onClick: () => { onExportSelected?.(); onClose(); } },
  ];

  const columnItems: ContextMenuAction[] = [
    { label: 'Rename', onClick: () => { onRenameColumn?.(); onClose(); } },
    { label: 'Change Type', onClick: () => { onChangeType?.(); onClose(); } },
    { label: 'Hide', onClick: () => { onHideColumn?.(); onClose(); } },
    { label: 'Delete', onClick: () => { onDeleteColumn?.(); onClose(); } },
  ];

  const items = type === 'row' ? rowItems : columnItems;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-white border border-gray-200 rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={item.onClick}
          disabled={item.disabled}
          role="menuitem"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
