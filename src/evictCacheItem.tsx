import assert from "assert";
import { log } from "./log.js";
import { FileId } from "./types.js";
import { ManagedUriStorage } from "./useLocalUri.js";

/**
 * Evict the oldest cached file (that is not pending, recent or mounted) to free cache space.
 *
 * @param cachedIds - Array of currently cached file IDs.
 * @param mountedIds - Array of mounted file IDs.
 * @param recentIds - Array of recent file IDs.
 * @param setUri - Function to set URI in storage.
 * @returns The evicted file ID, or null if no candidate can be evicted.
 */
export const evictCacheItem = async (
  cachedIds: FileId[],
  mountedIds: FileId[],
  recentIds: FileId[],
  setUri: ManagedUriStorage["setUri"],
): Promise<FileId | null> => {
  assert(setUri);
  const candidates = cachedIds.filter(
    (id) => !mountedIds.includes(id) && !recentIds.includes(id),
  );
  if (candidates.length === 0) return null;
  const evictId = candidates[candidates.length - 1];
  assert(evictId);
  await setUri(evictId, undefined);
  log(`Evicted cache item: ${evictId}`);
  return evictId;
};
