import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { validateRouteParams } from '@/utils/validateParams';

/**
 * Hook that validates route parameters against expected patterns.
 * Redirects to /404 if any parameter is invalid (UUID for IDs, slug for others).
 */
export function useValidatedParams<T extends Record<string, string | undefined>>(): T {
  const params = useParams() as T;
  const navigate = useNavigate();

  useEffect(() => {
    if (!validateRouteParams(params as Record<string, string | undefined>)) {
      navigate('/404', { replace: true });
    }
  }, [params, navigate]);

  return params;
}
