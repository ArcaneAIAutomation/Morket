export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: { page: number; limit: number; total: number };
}

export function successResponse<T>(
  data: T,
  meta?: { page: number; limit: number; total: number }
): ApiResponse<T> {
  const response: ApiResponse<T> = {
    success: true,
    data,
    error: null,
  };
  if (meta !== undefined) {
    response.meta = meta;
  }
  return response;
}

export function errorResponse(code: string, message: string): ApiResponse<null> {
  return {
    success: false,
    data: null,
    error: { code, message },
  };
}
