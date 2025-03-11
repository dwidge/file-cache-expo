/**
 * @module fileCache/provider
 *
 * This module defines the FileCacheProvider, which exposes an API for
 * retrieving file data URIs from a local cache, synchronizing pending uploads,
 * and refreshing the cache from the remote source.
 */

import { useLocal } from "@dwidge/crud-api-react";
import {
  AsyncDispatch,
  AsyncState,
  Json,
  useConvert,
  useJson,
} from "@dwidge/hooks-react";
import assert from "assert";
import { AxiosInstance } from "axios";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { z } from "zod";
import {
  getBufferFromUrlAndVerify,
  putBufferToUrlAndVerify,
} from "./getBufferFromUrl.js";
import {
  DataUri,
  Deleted,
  Disabled,
  FileId,
  FileMeta,
  FileRecord,
  GetFileUrls,
  Loading,
} from "./types.js";
import { getDataUriFromBufferBin, getMetaBufferFromDataUri } from "./uri.js";
import { ManagedUriStorage, useManagedUriItem } from "./useLocalUri.js";
import { useMountTracker, useMountTrackerItem } from "./useMountTracker.js";

const log = (...args) => {};
// const log = (...args) => console.log(...args);

/**
 * The API exposed by the File Cache system.
 */
export type FileCache = {
  /**
   * Hook to retrieve a file’s data URI. It will cause missing file data to download to cache if isOnline is true.
   */
  useItem: (fileId?: FileId) => AsyncState<DataUri | null> | Disabled;
  /**
   * Hook to get a list of file IDs in the cache.
   */
  useCacheList: () => FileId[] | Loading;
  /**
   * Hook to get a list of file IDs in the cache that are pending upload.
   */
  usePendingList: () => FileId[] | Loading;
  /**
   * Trigger a sync operation to upload pending files from cache and download speculative files to cache.
   * @param options - Optional parameters: an AbortSignal and a progress notifier.
   * @returns A promise that resolves when the sync operation is complete.
   */
  sync?: (options?: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    pull?: boolean;
  }) => Promise<void>;
  /**
   * Function to reset the file cache, deleting all cached files and clearing lists.
   */
  reset?: () => Promise<void>;
};

export const FileCacheContext = createContext<FileCache>({
  useItem: () => [null, undefined],
  useCacheList: () => [],
  usePendingList: () => [],
  sync: async () => {},
  reset: async () => {},
});

/**
 * Props for the FileCacheProvider.
 */
export type FileCacheProviderProps = {
  children: ReactNode;
  /** Maximum number of items in total to store in cache. */
  maxCache: number;
  /** Maximum number of pending items to store in cache. */
  maxPending?: number;
  /** Maximum number of mounted items to fetch automatically when online. */
  maxMounted?: number;
  /** Maximum number of recent items to store in cache. */
  maxRecent: number;
  /** Flag to enable auto fetching of mounted ids. */
  isOnline: boolean;
  /**
   * Function to provide file IDs that are eligible for caching.
   * (Typically ordered by latest first (updatedAt descending).)
   */
  getCacheableIds?: (maxItemsToCache: number) => Promise<FileId[] | undefined>;
  /**
   * Function to upload a file.
   * Receives the file id and its DataUri (or null to indicate deletion).
   */
  uploadFile?: (id: FileId, data: DataUri | Deleted) => Promise<void>;
  /**
   * Function to download a file.
   * Receives the file id and should return the file’s DataUri (or null if it does not exist).
   */
  downloadFile?: (id: FileId) => Promise<DataUri | Deleted>;

  cacheStorage?: ManagedUriStorage;
  pendingIds?: AsyncState<FileId[]>;
};

/* ──────────────────────────────────────────────────────────────────────────── *
 *                         HELPER FUNCTIONS
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Evict the oldest cached file (that is not pending, recent or mounted) to free cache space.
 *
 * @param cachedIds - Array of currently cached file IDs.
 * @param pendingIds - Array of pending file IDs.
 * @param mountedIds - Array of mounted file IDs.
 * @param recentIds - Array of recent file IDs.
 * @param setUri - Function to set URI in storage.
 * @returns The evicted file ID, or null if no candidate can be evicted.
 */
const evictCacheItem = async (
  cachedIds: FileId[],
  pendingIds: FileId[],
  mountedIds: FileId[],
  recentIds: FileId[],
  setUri: ManagedUriStorage["setUri"],
): Promise<FileId | null> => {
  assert(setUri);
  const candidates = cachedIds.filter(
    (id) =>
      !pendingIds.includes(id) &&
      !mountedIds.includes(id) &&
      !recentIds.includes(id),
  );
  if (candidates.length === 0) return null;
  // For simplicity, evict the last/oldest candidate.
  const evictId = candidates[candidates.length - 1];
  assert(evictId);
  await setUri(evictId, null);
  log(`Evicted cache item: ${evictId}`);
  return evictId;
};

/**
 * Add an ID to the top of the list, maintaining the limit and order by recency.
 * If the ID is already in the list, move it to the beginning.
 *
 * @param ids - Current IDs.
 * @param id - ID to add.
 * @param maxIds - Maximum number of IDs to keep.
 * @returns Updated list.
 */
const addToLimitedQueue = (
  ids: FileId[],
  id: FileId,
  maxIds?: number,
): FileId[] => {
  const updatedRecentIds = [id, ...ids.filter((recentId) => recentId !== id)];
  return maxIds !== undefined
    ? updatedRecentIds.slice(0, maxIds)
    : updatedRecentIds; // Apply slice only if maxIds is provided
};

/* ──────────────────────────────────────────────────────────────────────────── *
 *                    UPLOAD / DOWNLOAD HOOKS
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Hook to get a function that uploads a file to remote storage.
 *
 * @param getUrls - A function that returns signed URLs for a file.
 * @returns A function that uploads the file data.
 */
export const useUploadFileId = (
  getUrls?: GetFileUrls,
  axios?: AxiosInstance,
): ((id: FileId, data: DataUri | Deleted) => Promise<void>) | Disabled =>
  getUrls && axios
    ? async (id: FileId, data: DataUri | null): Promise<void> => {
        log(`useUploadFileId1`, id, data?.length);
        if (data === null) {
          // If the file is to be deleted, you could call a remote deletion API here.
          log(
            `File ${id} marked for deletion; not implemented, skipping upload.`,
          );
          return;
        }
        // Process the DataUri to extract binary data and metadata.
        const file = await getMetaBufferFromDataUri(data);
        if (!file)
          throw new Error(
            `useUploadFileIdE1: Unable to process data for file ${id}`,
            { cause: { id } },
          );

        const { meta, buffer } = file;
        // Retrieve signed URLs.
        const fileRecord = await getUrls({ id });
        const { getUrl, putUrl } = fileRecord ?? {};
        if (!putUrl || !getUrl) {
          log("useUploadFileIdE2", fileRecord);
          throw new Error(
            `useUploadFileIdE2: Missing upload URLs for file ${id}`,
            {
              cause: { id, urls: { getUrl, putUrl } },
            },
          );
        }

        log(`Uploading file ${id}`);
        await putBufferToUrlAndVerify({
          data: buffer,
          putUrl,
          getUrl,
          meta,
          axios,
        });
        log(`File ${id} upload successful`);
      }
    : undefined;

/**
 * Hook to get a function that downloads a file from remote storage.
 *
 * @param getUrls - A function that returns signed URLs for a file.
 * @returns A function that downloads and returns the file’s DataUri.
 */
export const useDownloadFileId = (
  getUrls?: GetFileUrls,
  axios?: AxiosInstance,
): ((id: FileId) => Promise<DataUri | null>) | Disabled =>
  getUrls
    ? async (id: FileId): Promise<DataUri | null> => {
        const record: Partial<FileRecord> | null = await getUrls({ id });
        if (!record) return null; // File record is null

        // Here we assume that the remote metadata (size, mime, sha256) is available.
        // In practice you might need to call an API to get complete file meta.

        if (
          record.size === null &&
          record.mime === null &&
          record.sha256 === null
        )
          return null; // File data is null

        if (record.size == null || record.mime == null || record.sha256 == null)
          throw new Error(
            `useDownloadFileIdE1: Incomplete file meta for file ${id}`,
            { cause: { fileMeta: record } },
          );

        if (!record.getUrl) {
          log(`No download URL available for file ${id}`);
          return null;
        }

        const meta: FileMeta = {
          size: record.size,
          mime: record.mime,
          sha256: record.sha256,
        };
        const bufferBin = await getBufferFromUrlAndVerify({
          getUrl: record.getUrl,
          meta,
          axios,
        });
        return bufferBin ? getDataUriFromBufferBin(bufferBin) : null;
      }
    : undefined;

/**
 * Hook to get signed URLs for a file.
 *
 * @param getFile - Function to retrieve a file’s metadata.
 * @returns A function that returns the signed URLs.
 */
const useGetUrlsMock =
  () =>
  async (
    filter?: FileRecord,
  ): Promise<Pick<FileRecord, "putUrl" | "getUrl"> | null> => {
    return {};
  };

/* ──────────────────────────────────────────────────────────────────────────── *
 *                           FILECACHE PROVIDER
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Hook to manage cache eviction.
 * This hook runs in useEffect within FileCacheProvider and evicts old cache items.
 */
const useEvictionCacheManager = ({
  maxCache,
  cachedFileIds,
  pendingFileIds,
  recentFileIds,
  mountedFileIds,
  setUri,
}: {
  maxCache: number;
  cachedFileIds: FileId[] | Loading;
  pendingFileIds: FileId[] | Loading;
  recentFileIds: FileId[] | Loading;
  mountedFileIds: FileId[];
  setUri: ManagedUriStorage["setUri"] | Disabled;
}) => {
  useEffect(() => {
    if (
      typeof cachedFileIds !== "object" ||
      typeof pendingFileIds !== "object" ||
      typeof recentFileIds !== "object" ||
      !setUri
    ) {
      return; // Wait for lists and storage to be loaded
    }

    const runEviction = async () => {
      let currentCachedIds = [...cachedFileIds];

      while (currentCachedIds.length > maxCache) {
        const evictedId = await evictCacheItem(
          currentCachedIds,
          pendingFileIds,
          recentFileIds,
          mountedFileIds,
          setUri,
        );
        if (!evictedId) {
          log(
            "Cache eviction failed to make space, stopping. Possibly too many mounted or pending files.",
            {
              mounted: mountedFileIds.length,
              pending: pendingFileIds.length,
              cached: cachedFileIds.length,
              maxCache,
            },
          );
          break; // Prevent infinite loop if no item can be evicted
        }
        currentCachedIds = currentCachedIds.filter(
          (cachedId) => cachedId !== evictedId,
        );
      }
    };

    runEviction();
  }, [
    maxCache,
    cachedFileIds,
    pendingFileIds,
    recentFileIds,
    mountedFileIds,
    setUri,
  ]);
};

/**
 * Hook to manage live cache loading for mounted items.
 * This hook runs in useEffect within FileCacheProvider and fetches data for mounted IDs if online and not cached.
 */
const useLiveCacheManager = ({
  isOnline,
  mountedFileIds,
  cachedFileIds,
  downloadFile,
  setUri,
}: {
  isOnline: boolean;
  mountedFileIds: FileId[];
  cachedFileIds: FileId[] | Loading;
  downloadFile: (id: FileId) => Promise<DataUri | Deleted>;
  setUri: ManagedUriStorage["setUri"] | Disabled;
}) => {
  useEffect(() => {
    if (!isOnline || typeof cachedFileIds !== "object" || !setUri) {
      return; // Only run when online, cache loaded and storage available
    }

    const runLiveCache = async () => {
      if (!isOnline) return;
      const currentCachedIds = new Set(cachedFileIds); // For faster lookups

      for (const id of mountedFileIds) {
        if (!currentCachedIds.has(id)) {
          log(`Live cache: Fetching mounted file ${id}...`);
          try {
            const dataUri = await downloadFile(id);
            await setUri(id, dataUri);
            if (dataUri)
              log(`Live cache: Fetched and cached mounted file ${id}`);
            else log(`Live cache: No data on server for mounted file ${id}`);
          } catch (error) {
            console.error(
              `Live cache: Error fetching mounted file ${id}:`,
              error,
            );
          }
        }
      }
    };

    runLiveCache();
  }, [isOnline, mountedFileIds, cachedFileIds, downloadFile, setUri]);
};

/**
 * The provider uses 4 lists:
 *
 * - cached: ids of file binary data cached on disk/in memory
 * - pending: ids of files waiting to be uploaded
 * - mounted: ids of files currently used in the app
 * - recent: ids of recently used files
 *
 * It also implements a sync function that first uploads pending files and then refreshes
 * the cache (evicting old items if necessary).
 *
 * @param props - FileCacheProviderProps.
 * @returns The provider component.
 */
export const FileCacheProvider = ({
  children,
  maxCache = 30,
  maxPending = 10,
  maxMounted = 10,
  maxRecent = 10,
  isOnline,
  getCacheableIds,
  uploadFile,
  downloadFile,
  cacheStorage,
  pendingIds: [pendingFileIds, setPendingFileIds] = usePendingIds(),
}: FileCacheProviderProps) => {
  const mountTracker = useMountTracker({ maxMounted, maxRecent });
  const { recent: recentFileIds, mounted: mountedFileIds } = mountTracker;

  const {
    ids: cachedFileIds,
    getUri,
    setUri,
    reset: resetStorage,
  } = cacheStorage ?? {};

  log("FileCacheProvider1", {
    pendingFileIds,
    mountedFileIds,
    recentFileIds,
    cachedFileIds,
  });

  // todo: when full it loops over and over trying to evict
  // useEvictionCacheManager({
  //   maxCache,
  //   cachedFileIds,
  //   pendingFileIds,
  //   recentFileIds,
  //   mountedFileIds,
  //   setUri,
  // });

  // todo: it may start fetching while sync is in progress, causing double fetch
  // useLiveCacheManager({
  //   isOnline,
  //   mountedFileIds,
  //   cachedFileIds,
  //   downloadFile,
  //   setUri,
  // });

  /**
   * Synchronize pending files by uploading each one.
   *
   * For each file ID in the pending list, the corresponding DataUri is loaded
   * from pending storage and then uploaded remotely. Upon successful upload,
   * the file ID is removed from the pending list.
   */
  const syncPendingFiles: ((signal?: AbortSignal) => Promise<void>) | Disabled =
    pendingFileIds && setPendingFileIds && getUri && uploadFile
      ? async (signal?: AbortSignal): Promise<void> => {
          log("Start upload pending list...", { count: pendingFileIds.length });
          for (const id of pendingFileIds) {
            if (signal?.aborted) throw new Error("Upload aborted");

            try {
              const dataUri = await getUri(id);
              if (signal?.aborted) throw new Error("Upload aborted");

              log(`Start upload pending file...`, {
                id,
                size: dataUri?.length ?? null,
              });
              await uploadFile(id, dataUri);
              if (signal?.aborted) throw new Error("Upload aborted");

              log(`Finish upload pending file.`, {
                id,
              });
              setPendingFileIds((prev) =>
                prev.filter((pendingId) => pendingId !== id),
              );
            } catch (error) {
              if (signal?.aborted) throw error;

              log(
                `syncPendingFilesE1: Error upload pending file ${id}: ${error}`,
                { cause: error },
              );
            }
          }
          log("Finish upload pending list.");
        }
      : undefined;

  /**
   * Refresh the cache by downloading the latest files.
   *
   * For each file ID in the cacheable list that is not already in cache,
   * download the file from remote. If the cache is full (taking into account
   * pending files), evict the oldest cached file (that is not pending) before
   * adding a new one. If the cache has old ids not in the list, remove them from cache.
   */
  const syncLatestFiles: ((signal?: AbortSignal) => Promise<void>) | Disabled =
    getCacheableIds && cachedFileIds && setUri && downloadFile
      ? async (signal?: AbortSignal) => {
          assert(cachedFileIds);
          assert(pendingFileIds);
          assert(mountedFileIds);
          assert(recentFileIds);

          // Start with a copy of the current cached file IDs.
          const cacheableCount = maxCache - (pendingFileIds?.length ?? 0);
          let currentCachedIds = [...cachedFileIds];
          const idsToFetch =
            (await getCacheableIds(cacheableCount))?.filter(
              (id) => !currentCachedIds.includes(id),
            ) ?? [];

          log("Start fetching...", { count: idsToFetch.length });
          for (const id of idsToFetch) {
            if (signal?.aborted) throw new Error("Sync aborted");

            // Check if cache is full (reserve space for pending items)
            if (currentCachedIds.length >= maxCache) {
              log(`Try to make space...`);
              const evicted = await evictCacheItem(
                currentCachedIds,
                pendingFileIds,
                mountedFileIds,
                recentFileIds,
                setUri,
              );
              if (!evicted) {
                log(
                  `Unable to evict cache item to make space. Stop fetching for cache.`,
                  {
                    fetchFileId: id,
                    currentCachedIds,
                    pendingFileIds,
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
            try {
              if (signal?.aborted) throw new Error("Sync aborted");

              log(`Try to fetch file ${id}...`);
              const dataUri = await downloadFile(id);
              if (signal?.aborted) throw new Error("Sync aborted");

              if (dataUri === null) {
                log(`File ${id} is deleted. Not added to cache.`);
              } else {
                await setUri(id, dataUri);
                currentCachedIds.push(id);
                log(`File ${id} fetched and cached.`);
              }
            } catch (error) {
              if (signal?.aborted) throw error;

              log(
                `syncLatestFilesE2: Error refreshing cache for file ${id}: ${error}`,
                { cause: error },
              );
            }
          }
          log("Finish fetching.");
        }
      : undefined;

  /**
   * Main sync function that uploads pending files and refreshes the cache.
   *
   * The function performs the following steps:
   * 1. Upload all pending files.
   * 2. Download new files to refresh the cache. If the cache is full, it evicts
   *    the oldest non-pending files.
   *
   * Optional parameters allow cancellation via an AbortSignal and reporting progress.
   *
   * @param options - Optional sync options:
   *   - signal: AbortSignal to cancel the sync operation.
   *   - onProgress: Callback function receiving progress (0 to 100).
   * @returns A promise that resolves when sync is complete.
   */
  const sync = useMemo(
    () =>
      syncPendingFiles && syncLatestFiles
        ? async (options?: {
            signal?: AbortSignal;
            onProgress?: (progress: number) => void;
            pull?: boolean;
          }) => {
            log("Sync started");
            const signal = options?.signal;
            if (signal?.aborted) throw new Error("Sync aborted");

            const totalTasks = 2;
            let completedTasks = 0;
            const reportProgress = () => {
              if (options?.onProgress) {
                const progress = completedTasks / totalTasks;
                options.onProgress(progress);
              }
            };

            await syncPendingFiles(signal);
            if (signal?.aborted) throw new Error("Sync aborted");

            completedTasks++;
            reportProgress();
            if (options?.pull !== false) await syncLatestFiles(signal);
            if (signal?.aborted) throw new Error("Sync aborted");

            completedTasks++;
            reportProgress();
            log("Sync finished");
          }
        : undefined,
    [
      syncPendingFiles,
      syncLatestFiles,
      pendingFileIds,
      mountedFileIds,
      recentFileIds,
    ],
  );

  /**
   * Function to reset the file cache, deleting all cached files and clearing lists.
   */
  const reset = useMemo(
    () =>
      resetStorage && setPendingFileIds
        ? async () => {
            log("FileCache reset started");
            await resetStorage();
            log("UriStorage reset completed");
            await setPendingFileIds([]);
            log("Pending IDs cleared");

            mountTracker.reset();
            log("Recent and Mounted IDs cleared");

            log("FileCache reset finished");
          }
        : undefined,
    [resetStorage, setPendingFileIds],
  );

  /**
   * Hook to retrieve a file’s DataUri from the cache.
   *
   * @param fileId - The file identifier.
   * @returns The async state tuple of the file’s DataUri.
   */
  const useItem = (fileId?: FileId): AsyncState<DataUri | null> | Disabled => {
    const [dataUri, setDataUri]: AsyncState<DataUri | null> =
      useManagedUriItem(fileId, cacheStorage) ?? [];

    // Register the fileId with the mount tracker.
    // This will automatically update both the mounted and recent lists.
    useMountTrackerItem(mountTracker, fileId);

    // Create a wrapped setter that adds the fileId to the pending list if updated.
    const setItem: AsyncDispatch<DataUri | null> | undefined = useMemo(
      () =>
        fileId !== undefined &&
        setDataUri &&
        pendingFileIds &&
        setPendingFileIds
          ? async (data) => {
              // Add the fileId to pending uploads.
              await addToPending(fileId);
              // Update the actual cached DataUri.
              return setDataUri(data);
            }
          : undefined,
      [fileId, setDataUri, pendingFileIds, setPendingFileIds, maxPending],
    );
    return [dataUri, setItem];
  };

  async function addToPending(fileId: FileId) {
    assert(pendingFileIds);
    assert(setPendingFileIds);
    if (maxPending !== undefined && pendingFileIds.length >= maxPending)
      throw new Error(
        "useItemE1: Pending file limit reached. Cannot add more files to upload.",
        {
          cause: {
            fileId,
            maxPending,
            pendingLength: pendingFileIds.length,
          },
        },
      );

    // Add the fileId to pending uploads.
    // Whether it has new data or is null/deleted.
    await setPendingFileIds((prev) => addToLimitedQueue(prev, fileId));
  }

  /**
   * Hook to retrieve the list of cached file IDs.
   */
  const useCacheList = useCallback((): FileId[] | Loading => {
    return cachedFileIds;
  }, [cachedFileIds]);

  /**
   * Hook to retrieve the list of pending file IDs.
   */
  const usePendingList = useCallback((): FileId[] | Loading => {
    return pendingFileIds;
  }, [pendingFileIds]);

  /**
   * Hook to retrieve the list of recent file IDs.
   */
  const useRecentList = useCallback((): FileId[] | Loading => {
    return recentFileIds;
  }, [recentFileIds]);

  const value = useMemo(
    () => ({
      useItem,
      useCacheList,
      usePendingList,
      useRecentList,
      sync,
      reset,
    }),
    [useItem, useCacheList, usePendingList, useRecentList, sync, reset],
  );

  return (
    <FileCacheContext.Provider value={value}>
      {children}
    </FileCacheContext.Provider>
  );
};

/* ──────────────────────────────────────────────────────────────────────────── *
 *                          SUPPORTING HOOKS & CONVERTERS
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Hook to access the file cache API.
 *
 * @returns The file cache API.
 */
export const useFileCache = (): FileCache => {
  return useContext(FileCacheContext);
};

/**
 * Hook to access a file’s DataUri.
 *
 * @param fileId - The file identifier.
 * @returns The async state tuple of the file’s DataUri.
 */
export const useFileUri = (
  fileId?: FileId,
): AsyncState<DataUri | null> | Disabled => {
  const { useItem } = useFileCache();
  return useItem(fileId);
};

/**
 * Hook to access the pending file IDs.
 *
 * @returns Array of pending file IDs.
 */
export const usePendingFileIds = (): FileId[] | Loading =>
  useContext(FileCacheContext).usePendingList();

/**
 * Hook to trigger file cache synchronization.
 *
 * @returns The sync function.
 */
export const useFileCacheSync = () => {
  const { sync } = useFileCache();
  return sync;
};

/**
 * Hook to trigger file cache reset.
 *
 * @returns The reset function.
 */
export const useFileCacheReset = () => {
  const { reset } = useFileCache();
  return reset;
};

/**
 * Hook to retrieve the list of pending file IDs.
 * We assume that pending IDs are stored as JSON in local storage.
 */
const usePendingIds = (): AsyncState<FileId[]> => {
  const ids = useStringArray(
    useJson(useLocal<string | null>("pendingFileIds", null)),
  );
  return ids;
};

/**
 * Hook to retrieve the list of recent file IDs.
 */
const useRecentIds = (): AsyncState<FileId[]> => {
  const ids = useStringArray(
    useJson(useLocal<string | null>("recentFileIds", null)),
  );
  return ids;
};

/**
 * A converter hook to transform JSON into an array of strings.
 */
const useStringArray = useConvert<Json, string[]>(
  (v: Json) => z.string().array().nullable().parse(v) ?? [],
  (v: string[]) => z.string().array().parse(v),
);
