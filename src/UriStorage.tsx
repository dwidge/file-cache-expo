import { DataUri } from "./types";

/**
 * Interface for local URI storage operations.
 */

export interface UriStorage {
  getUri: (id: string) => Promise<DataUri | null | undefined>;
  setUri: (
    id: string,
    uri: DataUri | null | undefined,
  ) => Promise<DataUri | null | undefined>;
  deleteUri: (id: string) => Promise<null>;
  getIds: () => Promise<string[]>;
  reset: () => Promise<void>;
}

export function assertStorageAvailable(
  storageName: string,
  condition: boolean,
): asserts condition {
  if (!condition) {
    throw new Error(`${storageName} is not available in this environment.`);
  }
}
