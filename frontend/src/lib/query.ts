import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile users hit flaky networks; treat failures as recoverable.
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      // Re-fetch when the tab becomes visible again (mobile backgrounding).
      refetchOnWindowFocus: true,
      // Keep data alive briefly so navigate-back feels instant.
      staleTime: 10_000,
    },
    mutations: {
      retry: 0,
    },
  },
});