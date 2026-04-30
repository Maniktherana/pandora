import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient singleton.
 *
 * Used both in the React tree (QueryClientProvider in main.tsx) and in
 * service-layer code that lives outside of React component context, such as
 * IPC event handlers that need to push fresh data into the cache directly
 * via `queryClient.setQueryData`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});
