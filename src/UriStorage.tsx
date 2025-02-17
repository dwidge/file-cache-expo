import { DataUri } from "./types";

/**
 * Interface for local URI storage operations.
 */

export interface UriStorage {
  getUri: (id: string) => Promise<DataUri | null>;
  setUri: (id: string, uri: DataUri | null) => Promise<DataUri | null>;
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
