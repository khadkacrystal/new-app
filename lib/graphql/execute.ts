/**
 * The one function every call to the embedded GraphQL endpoint should go
 * through. Ties a typed `GraphQLOperation` to a `BridgeTransport`, applies
 * error classification, and returns the plain `TData` — or throws a typed
 * `AppGraphQLError`. Call sites never touch `response.body` directly.
 */

import type {
  GraphQLOperation,
  GraphQLResult,
  OperationData,
  OperationVars,
} from "./types";
import type { BridgeTransport } from "./client";
import { classifyErrors, toAppGraphQLError } from "./errors";

export async function execute<Op extends GraphQLOperation<unknown, unknown>>(
  operation: Op,
  variables: OperationVars<Op>,
  bridge: BridgeTransport,
): Promise<OperationData<Op>> {
  try {
    const { body } = await bridge.graphql(
      operation.document,
      variables as Record<string, unknown>,
    );
    const envelope = body as GraphQLResult<OperationData<Op>>;

    const error = classifyErrors(envelope.errors);
    if (error) {
      throw error;
    }

    if (envelope.data === null || envelope.data === undefined) {
      throw new Error("GraphQL response had no data and no errors");
    }

    return envelope.data;
  } catch (err) {
    throw toAppGraphQLError(err);
  }
}
