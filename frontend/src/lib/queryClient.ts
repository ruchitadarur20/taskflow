import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => {
        // Don't burn retries on 4xx (auth/permission/not-found) - only
        // transient network/5xx failures are worth an automatic retry.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
