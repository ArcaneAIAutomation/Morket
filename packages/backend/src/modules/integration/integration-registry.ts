import type { CrmAdapter } from './adapters/types';
import { salesforceAdapter } from './adapters/salesforce.adapter';
import { hubspotAdapter } from './adapters/hubspot.adapter';

const registry = new Map<string, CrmAdapter>();

// Register built-in adapters
registry.set(salesforceAdapter.slug, salesforceAdapter);
registry.set(hubspotAdapter.slug, hubspotAdapter);

export function getAdapter(slug: string): CrmAdapter | undefined {
  return registry.get(slug);
}

export function listAdapters(): CrmAdapter[] {
  return Array.from(registry.values());
}

export function registerAdapter(adapter: CrmAdapter): void {
  registry.set(adapter.slug, adapter);
}
