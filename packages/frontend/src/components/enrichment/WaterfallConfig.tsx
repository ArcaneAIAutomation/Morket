import { useState, useCallback } from 'react';
import type { Provider, EnrichmentFieldType } from '@/types/enrichment.types';
import type { WaterfallConfig as WaterfallConfigType } from '@/types/enrichment.types';

interface WaterfallConfigProps {
  field: EnrichmentFieldType;
  providers: Provider[];
  config: string[];
  onChange: (field: EnrichmentFieldType, providers: string[]) => void;
}

const FIELD_LABELS: Record<EnrichmentFieldType, string> = {
  email: 'Email',
  phone: 'Phone',
  company_info: 'Company Info',
  job_title: 'Job Title',
  social_profiles: 'Social Profiles',
  address: 'Address',
};

export function WaterfallConfig({ field, providers, config, onChange }: WaterfallConfigProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      setDragOverIndex(null);
      setDragIndex(null);

      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIndex) || fromIndex === dropIndex) return;

      const reordered = [...config];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(dropIndex, 0, moved);
      onChange(field, reordered);
    },
    [config, field, onChange],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  const providerMap = new Map(providers.map((p) => [p.slug, p]));

  return (
    <div className="mb-3">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {FIELD_LABELS[field]} — Provider Priority
      </h4>
      <div className="space-y-1">
        {config.map((slug, index) => {
          const provider = providerMap.get(slug);
          if (!provider) return null;

          const isDragging = dragIndex === index;
          const isDragOver = dragOverIndex === index;

          return (
            <div
              key={slug}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 px-3 py-2 rounded border text-sm cursor-grab active:cursor-grabbing transition-colors ${
                isDragging ? 'opacity-50 border-dashed border-blue-400' : ''
              } ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}
            >
              <span className="text-gray-400 select-none" aria-hidden="true">⠿</span>
              <span className="text-xs text-gray-400 font-mono w-4">{index + 1}.</span>
              <span className="flex-1 font-medium text-gray-700">{provider.displayName}</span>
              <span className="text-xs text-gray-400">{provider.creditCostPerCall} credits</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { FIELD_LABELS };
export type { WaterfallConfigProps };
