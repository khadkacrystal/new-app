"use client";

import { useEffect, useState } from "react";
import type {
  GraphQLOperation,
  OperationData,
  OperationVars,
} from "@/lib/graphql/types";
import type { BridgeTransport } from "@/lib/graphql/client";
import { execute } from "@/lib/graphql/execute";
import { toAppGraphQLError, type AppGraphQLError } from "@/lib/graphql/errors";

export interface UseGraphQLResult<TData> {
  data: TData | null;
  loading: boolean;
  error: AppGraphQLError | null;
}

/**
 * Generic bridge-backed query hook. One hook covers every operation —
 * pass the typed `GraphQLOperation` and its variables, get back typed data.
 *
 * const { data, loading, error } = useGraphQL(bridge, ItemsQuery, { first: 20 });
 * data?.items.nodes // typed as Item[]
 */
export function useGraphQL<Op extends GraphQLOperation<unknown, unknown>>(
  bridge: BridgeTransport,
  operation: Op,
  variables: OperationVars<Op>,
): UseGraphQLResult<OperationData<Op>> {
  const [data, setData] = useState<OperationData<Op> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppGraphQLError | null>(null);

  // Variables are re-serialized so effect deps stay stable across renders
  // even when the caller passes a fresh object literal each time.
  const variablesKey = JSON.stringify(variables);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const result = await execute(operation, variables, bridge);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(toAppGraphQLError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, operation, variablesKey]);

  return { data, loading, error };
}
