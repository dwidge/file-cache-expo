import assert from "assert";
import pLimit from "p-limit";
import { processInChunks } from "./chunked.js";
import { evictCacheItem } from "./evictCacheItem.js";
import { log } from "./log.js";
import { setCacheError } from "./setCacheError.js";
import { setMissingId } from "./setMissingId.js";
import { FileId } from "./types.js";
import { DownloadFileId } from "./useDownloadFileId.js";
import { GetSignedUrlsById } from "./useGetUrlsById.js";
import { ManagedUriStorage } from "./useLocalUri.js";

/**
 * Refresh the cache by downloading the latest files.
 *
 * For each file ID in the cacheable list that is not already in cache,
 * download the file from remote. If the cache is full (taking into account
 * pending files), evict the oldest cached file (that is not pending) before
 * adding a new one. If the cache has old ids not in the list, remove them from cache.
 */
export const syncLatestFiles = async ({
  getCacheableIds,
  cacheFileIds,
  downloadFile,
  getSignedUrls,
  setCacheUri,
  maxCache,
  mountedFileIds,
  recentFileIds,
  setMissingFileIds,
  setCacheErrors,
  signal,
  concurrency = 1,
}: {
  getCacheableIds: (maxItemsToCache: number) => Promise<FileId[] | undefined>;
  cacheFileIds: FileId[];
  downloadFile: DownloadFileId;
  getSignedUrls: GetSignedUrlsById;
  setCacheUri: NonNullable<ManagedUriStorage["setUri"]>;
  maxCache: number;
  mountedFileIds: FileId[];
  recentFileIds: FileId[];
  setMissingFileIds: React.Dispatch<React.SetStateAction<FileId[]>>;
  setCacheErrors: React.Dispatch<React.SetStateAction<Record<FileId, string>>>;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<void> => {
  assert(cacheFileIds);
  assert(mountedFileIds);
  assert(recentFileIds);

  const cacheableCount = ((maxCache * 3) / 4) | 0;
  const cacheableIds = (await getCacheableIds(cacheableCount)) ?? [];
  let currentCachedIds = [...cacheFileIds];
  const idsToFetch = [...recentFileIds, ...cacheableIds]
    .filter((id) => !currentCachedIds.includes(id))
    .slice(0, cacheableCount);

  log("Start fetching...", { count: idsToFetch.length });
  if (idsToFetch.length === 0) {
    log("Finish fetching, no new files.");
    return;
  }

  const numToEvict = Math.max(
    0,
    currentCachedIds.length + idsToFetch.length - maxCache,
  );
  if (numToEvict > 0) {
    log(`Try to make space in cacheStorage by evicting ${numToEvict} items...`);
    for (let i = 0; i < numToEvict; i++) {
      const evicted = await evictCacheItem(
        currentCachedIds,
        mountedFileIds,
        recentFileIds,
        setCacheUri,
      );
      if (!evicted) {
        log(
          `Unable to evict cache item to make space in cacheStorage. Stop fetching for cache.`,
          {
            currentCachedIds,
            mountedFileIds,
            recentFileIds,
          },
        );
        break;
      }
      currentCachedIds = currentCachedIds.filter(
        (cachedId) => cachedId !== evicted,
      );
    }
  }

  const finalIdsToFetch = idsToFetch.slice(
    0,
    maxCache - currentCachedIds.length,
  );

  log("Start fetching...", { count: finalIdsToFetch.length });

  if (finalIdsToFetch.length === 0) {
    log("Finish fetching, no new files to fetch.");
    return;
  }

  setMissingFileIds([]);
  setCacheErrors({});

  const urlRecords = await processInChunks(finalIdsToFetch, 50, getSignedUrls);

  const urlRecordsMap = new Map(
    urlRecords.filter((r) => r).map((r) => [r!.id, r!]),
  );

  const limit = pLimit(concurrency);
  const promises = finalIdsToFetch.map((id) =>
    limit(async () => {
      if (signal?.aborted) throw new Error("Sync aborted");

      try {
        log(`Try to fetch file ${id}...`);
        const record = urlRecordsMap.get(id);
        if (!record) {
          log(
            `File ${id} not found on server (no signed URL). Adding to missing.`,
          );
          setMissingFileIds(setMissingId(id, true));
          return;
        }

        const dataUri = await downloadFile(record);
        if (signal?.aborted) throw new Error("Sync aborted");

        if (dataUri === undefined) {
          log(`File ${id} not found on server. Adding to missing.`);
          setMissingFileIds(setMissingId(id, true));
        } else if (dataUri === null) {
          log(`File ${id} is deleted. Not added to cache.`);
        } else {
          await setCacheUri(id, dataUri);
          currentCachedIds.push(id);
          log(`File ${id} fetched and cached.`);
        }
      } catch (error: unknown) {
        if (signal?.aborted) throw error;

        log(
          `syncLatestFilesE2: Error refreshing cache for file ${id}: ${error}`,
          { cause: error },
        );
        setCacheErrors(setCacheError(id, `${error}`));
        throw error;
      }
    }),
  );

  log("Finish fetching.");

  const results = await Promise.allSettled(promises);
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => (result as PromiseRejectedResult).reason);
  if (errors.length > 0) {
    throw new AggregateError(errors, "One or more downloads failed");
  }
};
