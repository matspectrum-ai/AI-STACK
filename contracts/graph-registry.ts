import type {
  ExecutionGraphDefinition,
  GraphDefinitionLookupResult,
  GraphDefinitionRegistry,
} from "./execution";

export type RegisterGraphDefinitionResult =
  | {
      readonly status: "REGISTERED" | "REPLAYED";
      readonly graph: ExecutionGraphDefinition;
    }
  | {
      readonly status: "CONFLICT";
    }
  | {
      readonly status: "INVALID_GRAPH";
    };

export interface DurableGraphDefinitionRegistry extends GraphDefinitionRegistry {
  register(
    graph: ExecutionGraphDefinition,
  ): Promise<RegisterGraphDefinitionResult>;

  get(
    graphId: ExecutionGraphDefinition["graphId"],
    graphVersion: string,
  ): Promise<GraphDefinitionLookupResult>;
}
