import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { useRole } from '@/hooks/useRole';
import { getOptions, saveOption, deleteOption, testConnection } from '@/api/options.api';
import { formatDateTime } from '@/utils/formatters';
import type { ServiceConfiguration, ConnectionTestResult } from '@/types/api.types';

// ---------------------------------------------------------------------------
// Service registry — defines groups, services, and their form fields
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder: string;
}

interface ServiceDef {
  serviceKey: string;
  label: string;
  group: string;
  fields: FieldDef[];
  note?: string;
}

interface GroupDef {
  group: string;
  label: string;
  services: ServiceDef[];
}

const SERVICE_GROUPS: GroupDef[] = [
  {
    group: 'enrichment',
    label: 'Enrichment Providers',
    services: [
      {
        serviceKey: 'apollo',
        label: 'Apollo',
        group: 'enrichment',
        fields: [{ key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Enter Apollo API key' }],
        note: 'Also synced to Credentials for backward compatibility.',
      },
      {
        serviceKey: 'clearbit',
        label: 'Clearbit',
        group: 'enrichment',
        fields: [{ key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Enter Clearbit API key' }],
        note: 'Also synced to Credentials for backward compatibility.',
      },
      {
        serviceKey: 'hunter',
        label: 'Hunter',
        group: 'enrichment',
        fields: [{ key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Enter Hunter API key' }],
        note: 'Also synced to Credentials for backward compatibility.',
      },
    ],
  },
  {
    group: 'scraping',
    label: 'Scraping Service',
    services: [
      {
        serviceKey: 'scraper',
        label: 'Scraper',
        group: 'scraping',
        fields: [
          { key: 'serviceUrl', label: 'Service URL', type: 'url', placeholder: 'https://scraper.example.com' },
          { key: 'serviceKey', label: 'Service Key', type: 'password', placeholder: 'X-Service-Key value' },
        ],
      },
    ],
  },
  {
    group: 'crm',
    label: 'CRM Integrations',
    services: [
      {
        serviceKey: 'salesforce',
        label: 'Salesforce',
        group: 'crm',
        fields: [
          { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'OAuth Client ID' },
          { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'OAuth Client Secret' },
        ],
      },
      {
        serviceKey: 'hubspot',
        label: 'HubSpot',
        group: 'crm',
        fields: [
          { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'OAuth Client ID' },
          { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'OAuth Client Secret' },
        ],
      },
    ],
  },
  {
    group: 'billing',
    label: 'Billing',
    services: [
      {
        serviceKey: 'stripe',
        label: 'Stripe',
        group: 'billing',
        fields: [
          { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...' },
          { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...' },
        ],
      },
    ],
  },
  {
    group: 'infrastructure',
    label: 'Infrastructure',
    services: [
      {
        serviceKey: 'temporal',
        label: 'Temporal',
        group: 'infrastructure',
        fields: [
          { key: 'address', label: 'Address', type: 'url', placeholder: 'localhost:7233' },
          { key: 'namespace', label: 'Namespace', type: 'text', placeholder: 'default' },
        ],
      },
      {
        serviceKey: 'opensearch',
        label: 'OpenSearch',
        group: 'infrastructure',
        fields: [
          { key: 'endpoint', label: 'Endpoint', type: 'url', placeholder: 'https://opensearch.example.com:9200' },
        ],
      },
      {
        serviceKey: 'redis',
        label: 'Redis',
        group: 'infrastructure',
        fields: [
          { key: 'url', label: 'URL', type: 'url', placeholder: 'redis://localhost:6379' },
        ],
      },
      {
        serviceKey: 'clickhouse',
        label: 'ClickHouse',
        group: 'infrastructure',
        fields: [
          { key: 'url', label: 'URL', type: 'url', placeholder: 'http://localhost:8123' },
          { key: 'database', label: 'Database', type: 'text', placeholder: 'morket' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Zod validation schema — values must be a non-empty record of non-empty strings
// ---------------------------------------------------------------------------

const valuesSchema = z
  .record(z.string().min(1, 'Value cannot be empty'), z.string().min(1, 'Value cannot be empty'))
  .refine((obj) => Object.keys(obj).length > 0, { message: 'At least one field is required' });

// ---------------------------------------------------------------------------
// Status dot component
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: ServiceConfiguration['status'] | 'not_configured' }) {
  const colors: Record<string, string> = {
    configured: 'bg-green-500',
    not_configured: 'bg-gray-400',
    error: 'bg-red-500',
  };
  const labels: Record<string, string> = {
    configured: 'Configured',
    not_configured: 'Not configured',
    error: 'Error',
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? 'bg-gray-400'}`} />
      {labels[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ServiceCard — renders a single service with form, status, and test button
// ---------------------------------------------------------------------------

interface ServiceCardProps {
  service: ServiceDef;
  config: ServiceConfiguration | undefined;
  workspaceId: string;
  onSaved: () => void;
  addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}

function ServiceCard({ service, config, workspaceId, onSaved, addToast }: ServiceCardProps) {
  const status = config?.status ?? 'not_configured';

  // Form values — initialise from masked config or empty
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of service.fields) {
      init[f.key] = '';
    }
    return init;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Test connection state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    // Only submit fields that have been filled in
    const toSubmit: Record<string, string> = {};
    for (const f of service.fields) {
      if (values[f.key].trim()) {
        toSubmit[f.key] = values[f.key].trim();
      }
    }

    // Validate with Zod
    const result = valuesSchema.safeParse(toSubmit);
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (key !== undefined) errs[String(key)] = issue.message;
      }
      // If the refinement failed (no fields), mark all fields
      if (Object.keys(errs).length === 0) {
        for (const f of service.fields) {
          errs[f.key] = 'This field is required';
        }
      }
      setFieldErrors(errs);
      return;
    }

    setIsSaving(true);
    try {
      await saveOption(workspaceId, service.serviceKey, result.data);
      addToast('success', `${service.label} configuration saved.`);
      // Clear form after save
      const cleared: Record<string, string> = {};
      for (const f of service.fields) cleared[f.key] = '';
      setValues(cleared);
      setFieldErrors({});
      setTestResult(null);
      onSaved();
    } catch {
      addToast('error', `Failed to save ${service.label} configuration.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteOption(workspaceId, service.serviceKey);
      addToast('success', `${service.label} configuration removed.`);
      setTestResult(null);
      onSaved();
    } catch {
      addToast('error', `Failed to remove ${service.label} configuration.`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection(workspaceId, service.serviceKey);
      setTestResult(res);
    } catch {
      setTestResult({ success: false, responseTimeMs: 0, error: 'Test request failed' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="border rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold">{service.label}</h4>
          <StatusDot status={status} />
        </div>
        {config && (
          <span className="text-xs text-gray-400">
            {config.lastTestedAt ? `Tested ${formatDateTime(config.lastTestedAt)}` : `Updated ${formatDateTime(config.updatedAt)}`}
          </span>
        )}
      </div>

      {service.note && (
        <p className="text-xs text-gray-400 mb-3">{service.note}</p>
      )}

      {/* Show masked values when configured */}
      {config && Object.keys(config.maskedValues).length > 0 && (
        <div className="mb-3 text-xs text-gray-500 space-y-1">
          {Object.entries(config.maskedValues).map(([k, v]) => (
            <div key={k}>
              <span className="font-medium">{k}:</span>{' '}
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Form fields */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: `repeat(${Math.min(service.fields.length, 2)}, 1fr)` }}>
        {service.fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={`${service.serviceKey}-${f.key}`} className="block text-xs font-medium text-gray-600 mb-1">
              {f.label}
            </label>
            <input
              id={`${service.serviceKey}-${f.key}`}
              type={f.type}
              value={values[f.key] ?? ''}
              onChange={(e) => handleFieldChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              className={`w-full border rounded px-3 py-1.5 text-sm ${fieldErrors[f.key] ? 'border-red-400' : ''}`}
              autoComplete="off"
            />
            {fieldErrors[f.key] && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors[f.key]}</p>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>

        {config && (
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeleting ? 'Removing…' : 'Remove'}
          </button>
        )}

        {config && (
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="px-3 py-1.5 text-sm text-gray-700 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {isTesting && (
              <svg className="animate-spin h-3.5 w-3.5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isTesting ? 'Testing…' : 'Test Connection'}
          </button>
        )}

        {/* Test result indicator */}
        {testResult && !isTesting && (
          <span className={`text-xs inline-flex items-center gap-1 ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.success ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Connected ({testResult.responseTimeMs}ms)
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                {testResult.error ?? 'Connection failed'}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main OptionsSettings component
// ---------------------------------------------------------------------------

export default function OptionsSettings() {
  const { can } = useRole();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const addToast = useUIStore((s) => s.addToast);

  const [configs, setConfigs] = useState<ServiceConfiguration[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const fetchConfigs = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getOptions(activeWorkspaceId);
      setConfigs(data);
    } catch {
      setError('Unable to load service configurations');
      setConfigs([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  // Role gate — only admin+ can access
  if (!can('manage_credentials')) {
    return (
      <div className="max-w-2xl">
        <p className="text-gray-500 text-sm">You do not have permission to manage service configurations.</p>
      </div>
    );
  }

  if (!activeWorkspaceId) {
    return <p className="text-gray-500 text-sm">No workspace selected.</p>;
  }

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const getConfig = (serviceKey: string) => configs.find((c) => c.serviceKey === serviceKey);

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-lg font-semibold">Options</h2>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-2 py-8 justify-center" aria-label="Loading configurations">
          <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-gray-500">Loading configurations…</span>
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4" role="alert">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={fetchConfigs}
            className="mt-2 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      )}

      {/* Service groups */}
      {!isLoading && !error && SERVICE_GROUPS.map((groupDef) => {
        const isCollapsed = collapsedGroups[groupDef.group] ?? false;
        return (
          <section key={groupDef.group} className="border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleGroup(groupDef.group)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
              aria-expanded={!isCollapsed}
            >
              <span className="text-sm font-semibold text-gray-800">{groupDef.label}</span>
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {!isCollapsed && (
              <div className="p-4 space-y-4 bg-gray-50/50">
                {groupDef.services.map((svc) => (
                  <ServiceCard
                    key={svc.serviceKey}
                    service={svc}
                    config={getConfig(svc.serviceKey)}
                    workspaceId={activeWorkspaceId}
                    onSaved={fetchConfigs}
                    addToast={addToast}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
