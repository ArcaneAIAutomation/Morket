import { z } from 'zod';

// --- Time Range Schemas ---

export const timeRangePresetSchema = z.enum(['24h', '7d', '30d', '90d']);

export type TimeRangePreset = z.infer<typeof timeRangePresetSchema>;

const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000; // 365 days in ms

export const customTimeRangeSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  })
  .refine((d) => new Date(d.start).getTime() < new Date(d.end).getTime(), {
    message: 'start must be before end',
  })
  .refine(
    (d) =>
      new Date(d.end).getTime() - new Date(d.start).getTime() <= MAX_RANGE_MS,
    { message: 'Time range must not exceed 365 days' },
  )
  .refine((d) => new Date(d.end).getTime() <= Date.now(), {
    message: 'end must not be in the future',
  });

export const timeRangeQuerySchema = z
  .union([z.object({ preset: timeRangePresetSchema }), customTimeRangeSchema])
  .default({ preset: '30d' });

export type TimeRangeQuery = z.infer<typeof timeRangeQuerySchema>;

// --- Granularity ---

export const granularitySchema = z.enum(['hour', 'day', 'week']);

export type Granularity = z.infer<typeof granularitySchema>;

// --- Pagination ---

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

// --- Workspace Params ---

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;

// --- Export Query ---

export const exportQuerySchema = z.object({
  format: z.literal('csv'),
  preset: timeRangePresetSchema.optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;

// --- Time Range Resolution ---

export interface TimeRange {
  start: Date;
  end: Date;
}

const PRESET_DURATIONS: Record<TimeRangePreset, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

/**
 * Converts a validated time range query (preset or custom) into concrete Date objects.
 */
export function resolveTimeRange(input: TimeRangeQuery): TimeRange {
  if ('preset' in input) {
    const now = new Date();
    const durationMs = PRESET_DURATIONS[input.preset];
    return {
      start: new Date(now.getTime() - durationMs),
      end: now,
    };
  }

  return {
    start: new Date(input.start),
    end: new Date(input.end),
  };
}
