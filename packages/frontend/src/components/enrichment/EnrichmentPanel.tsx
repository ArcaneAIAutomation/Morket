import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Provider, EnrichmentFieldType, WaterfallConfig as WaterfallConfigType } from '@/types/enrichment.types';
import type { BillingInfo } from '@/types/api.types';
import { getProviders } from '@/api/enrichment.api';
import { createEnrichmentJob } from '@/api/enrichment.api';
import { getBilling } from '@/api/billing.api';
import { useGridStore } from '@/stores/grid.store';
import { useJobStore } from '@/stores/job.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { formatCredits, formatNumber } from '@/utils/formatters';
import { WaterfallConfig, FIELD_LABELS } from './WaterfallConfig';

interface EnrichmentPanelProps {
  open: boolean;
  onClose: () => void;
}

const ALL_FIELDS: EnrichmentFieldType[] = [
  'email', 'phone', 'company_info', 'job_title', 'social_profiles', 'address',
];

/**
 * Groups providers by the enrichment fields they support.
 */
function groupProvidersByField(providers: Provider[]): Record<EnrichmentFieldType, Provider[]> {
  const groups = {} as Record<EnrichmentFieldType, Provider[]>;
  for (const field of ALL_FIELDS) {
    groups[field] = providers.filter((p) => p.supportedFields.includes(field));
  }
  return groups;
}

export function EnrichmentPanel({ open, onClose }: EnrichmentPanelProps) {
  const navigate = useNavigate();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const selectedRowIds = useGridStore((s) => s.selectedRowIds);
  const columns = useGridStore((s) => s.columns);
  const bulkUpdateEnrichmentStatus = useGridStore((s) => s.bulkUpdateEnrichmentStatus);
  const startPolling = useJobStore((s) => s.startPolling);
  const addToast = useUIStore((s) => s.addToast);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<EnrichmentFieldType>>(new Set());
  const [waterfallConfig, setWaterfallConfig] = useState<WaterfallConfigType>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedCount = selectedRowIds.size;
  const providersByField = useMemo(() => groupProvidersByField(providers), [providers]);

  // Fetch providers and billing when panel opens
  useEffect(() => {
    if (!open || !activeWorkspaceId) return;
    setIsLoading(true);
    Promise.all([getProviders(), getBilling(activeWorkspaceId)])
      .then(([providerData, billingData]) => {
        setProviders(providerData);
        setBilling(billingData);
      })
      .catch(() => {
        addToast('error', 'Failed to load enrichment configuration.');
      })
      .finally(() => setIsLoading(false));
  }, [open, activeWorkspaceId, addToast]);

  // Reset state when panel closes
  useEffect(() => {
    if (!open) {
      setSelectedFields(new Set());
      setWaterfallConfig({});
    }
  }, [open]);

  // Initialize waterfall config when a field is toggled
  const toggleField = useCallback(
    (field: EnrichmentFieldType) => {
      setSelectedFields((prev) => {
        const next = new Set(prev);
        if (next.has(field)) {
          next.delete(field);
          setWaterfallConfig((wc) => {
            const updated = { ...wc };
            delete updated[field];
            return updated;
          });
        } else {
          next.add(field);
          // Default waterfall: all supporting providers in original order
          const slugs = providersByField[field].map((p) => p.slug);
          setWaterfallConfig((wc) => ({ ...wc, [field]: { providers: slugs } }));
        }
        return next;
      });
    },
    [providersByField],
  );

  const handleWaterfallChange = useCallback(
    (field: EnrichmentFieldType, providerSlugs: string[]) => {
      setWaterfallConfig((prev) => ({ ...prev, [field]: { providers: providerSlugs } }));
    },
    [],
  );

  // --- Credit cost estimation (Task 10.3) ---
  const estimatedCost = useMemo(() => {
    let costPerRecord = 0;
    for (const field of selectedFields) {
      const fieldProviders = waterfallConfig[field]?.providers ?? [];
      // Waterfall: only the first provider is called per field (others are fallbacks),
      // but we estimate worst-case as the first provider's cost per field.
      if (fieldProviders.length > 0) {
        const firstSlug = fieldProviders[0];
        const provider = providers.find((p) => p.slug === firstSlug);
        if (provider) {
          costPerRecord += provider.creditCostPerCall;
        }
      }
    }
    return selectedCount * costPerRecord;
  }, [selectedCount, selectedFields, waterfallConfig, providers]);

  const creditBalance = billing?.creditBalance ?? 0;
  const isOverBudget = estimatedCost > creditBalance;

  // --- Run Enrichment submission (Task 10.4) ---
  const handleRunEnrichment = useCallback(async () => {
    if (!activeWorkspaceId || selectedFields.size === 0 || isOverBudget) return;

    setIsSubmitting(true);
    try {
      const recordIds = Array.from(selectedRowIds);
      const fields = Array.from(selectedFields);
      const job = await createEnrichmentJob(activeWorkspaceId, {
        recordIds,
        fields,
        waterfallConfig: Object.keys(waterfallConfig).length > 0 ? waterfallConfig : null,
      });

      // Mark affected cells as "pending"
      const updates = recordIds.flatMap((recordId) =>
        fields
          .map((field) => {
            // Find the column bound to this enrichment field
            const col = columns.find((c) => c.enrichmentField === field);
            if (!col) return null;
            return { recordId, field: col.field, status: 'pending' as const };
          })
          .filter(Boolean) as Array<{ recordId: string; field: string; status: 'pending' }>,
      );
      if (updates.length > 0) {
        bulkUpdateEnrichmentStatus(updates);
      }

      // Start polling for job status
      startPolling(activeWorkspaceId, job.id);

      addToast('success', `Enrichment job started (ID: ${job.id})`);
      onClose();
    } catch {
      addToast('error', 'Failed to start enrichment job.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    activeWorkspaceId, selectedFields, selectedRowIds, waterfallConfig,
    isOverBudget, columns, bulkUpdateEnrichmentStatus, startPolling, addToast, onClose,
  ]);

  // Available fields: only those that have at least one provider
  const availableFields = ALL_FIELDS.filter((f) => providersByField[f].length > 0);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Enrich Records</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close enrichment panel"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <>
            {/* Selected record count */}
            <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm text-blue-800">
              <span className="font-semibold">{formatNumber(selectedCount)}</span> record{selectedCount !== 1 ? 's' : ''} selected
            </div>

            {/* Field selection grouped by type */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Enrichment Fields</h3>
              <div className="space-y-2">
                {availableFields.map((field) => {
                  const fieldProviders = providersByField[field];
                  const isSelected = selectedFields.has(field);
                  return (
                    <div key={field} className="border border-gray-200 rounded-lg p-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleField(field)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-800">
                          {FIELD_LABELS[field]}
                        </span>
                        <span className="text-xs text-gray-400 ml-auto">
                          {fieldProviders.length} provider{fieldProviders.length !== 1 ? 's' : ''}
                        </span>
                      </label>

                      {/* Waterfall config for selected fields */}
                      {isSelected && waterfallConfig[field] && (
                        <div className="mt-2 ml-6">
                          <WaterfallConfig
                            field={field}
                            providers={fieldProviders}
                            config={waterfallConfig[field].providers}
                            onChange={handleWaterfallChange}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Credit estimation (Task 10.3) */}
            <div className="border-t border-gray-200 pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Estimated cost</span>
                <span className="font-semibold text-gray-900">{formatCredits(estimatedCost)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Credit balance</span>
                <span className={`font-semibold ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCredits(creditBalance)}
                </span>
              </div>
            </div>

            {/* Budget guard warning (Task 10.5) */}
            {isOverBudget && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                Insufficient credits. Estimated cost exceeds your balance.{' '}
                <button
                  onClick={() => {
                    onClose();
                    if (activeWorkspaceId) {
                      navigate(`/workspaces/${activeWorkspaceId}/settings/billing`);
                    }
                  }}
                  className="underline font-medium hover:text-red-900"
                >
                  Go to Billing Settings
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-200">
        <button
          onClick={handleRunEnrichment}
          disabled={isSubmitting || isOverBudget || selectedFields.size === 0 || selectedCount === 0}
          className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Starting…' : 'Run Enrichment'}
        </button>
      </div>
    </div>
  );
}
