import { useState } from 'react';
import { useAnalyticsStore } from '@/stores/analytics.store';
import type { TimeRangePreset } from '@/types/analytics.types';

const PRESETS: { value: TimeRangePreset; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

export default function TimeRangeFilter() {
  const timeRangePreset = useAnalyticsStore((s) => s.timeRangePreset);
  const customTimeRange = useAnalyticsStore((s) => s.customTimeRange);
  const setTimeRange = useAnalyticsStore((s) => s.setTimeRange);
  const setCustomTimeRange = useAnalyticsStore((s) => s.setCustomTimeRange);

  const [showCustom, setShowCustom] = useState(!!customTimeRange);
  const [startDate, setStartDate] = useState(customTimeRange?.start ?? '');
  const [endDate, setEndDate] = useState(customTimeRange?.end ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  function handlePresetClick(preset: TimeRangePreset) {
    setShowCustom(false);
    setValidationError(null);
    setTimeRange(preset);
  }

  function handleCustomToggle() {
    setShowCustom((prev) => !prev);
    setValidationError(null);
  }

  function handleApplyCustom() {
    if (!startDate || !endDate) {
      setValidationError('Both start and end dates are required.');
      return;
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end <= start) {
      setValidationError('End date must be after start date.');
      return;
    }
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 365) {
      setValidationError('Date range cannot exceed 365 days.');
      return;
    }
    setValidationError(null);
    setCustomTimeRange(startDate, endDate);
  }

  const isCustomActive = !timeRangePreset && !!customTimeRange;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => handlePresetClick(p.value)}
          className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
            timeRangePreset === p.value
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          aria-pressed={timeRangePreset === p.value}
        >
          {p.label}
        </button>
      ))}

      <button
        onClick={handleCustomToggle}
        className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
          isCustomActive
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
        aria-pressed={isCustomActive}
      >
        Custom
      </button>

      {showCustom && (
        <div className="flex items-center gap-2 ml-2">
          <label htmlFor="tr-start" className="sr-only">Start date</label>
          <input
            id="tr-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm"
          />
          <span className="text-gray-500 text-sm">to</span>
          <label htmlFor="tr-end" className="sr-only">End date</label>
          <input
            id="tr-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm"
          />
          <button
            onClick={handleApplyCustom}
            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Apply
          </button>
          {validationError && (
            <span className="text-red-600 text-xs" role="alert">{validationError}</span>
          )}
        </div>
      )}
    </div>
  );
}
