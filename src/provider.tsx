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
  useRef,
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
  useItem: (
    fileId?: FileId,
  ) => AsyncState<DataUri | null | undefined> | Disabled;
  getItem: ((id: string) => Promise<DataUri | null | undefined>) | undefined;
  /**
   * Hook to get a list of file IDs in the cache.
   */
  useCacheList: () => FileId[] | Loading;
  /**
   * Hook to get a list of file IDs in the cache that are pending upload.
   */
  usePendingList: () => FileId[] | Loading;
  /**
   * Hook to get a list of file IDs in the cache that are in error during upload.
   */
  useErrorList: () => FileId[] | Loading;
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
  /**
   * Function to trigger a refresh of non-pending cached files.
   * This will clear the cached data for non-pending files, triggering a refetch when they are next requested.
   */
  refreshNonPending?: (ids?: string[]) => Promise<void>;
};

export const FileCacheContext = createContext<FileCache>({
  useItem: () => [null, undefined],
  getItem: async () => null,
  useCacheList: () => [],
  usePendingList: () => [],
  useErrorList: () => [],
  sync: async () => {},
  reset: async () => {},
  refreshNonPending: async () => {}, // Added refreshNonPending to context
});

/**
 * Props for the FileCacheProvider.
 */
export type FileCacheProviderProps = {
  children: ReactNode;
  /** Maximum number of items in total to store in cache. */
  maxCache: number;
  /** Maximum number of pending items to store in upload cache. */
  maxUploadCache?: number;
  /** Maximum number of error items to store in upload error cache. */
  maxUploadErrorCache?: number;
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
  downloadFile?: (id: FileId) => Promise<DataUri | Deleted | undefined>;

  cacheStorage?: ManagedUriStorage;
  uploadStorage?: ManagedUriStorage;
  uploadErrorStorage?: ManagedUriStorage;
};

/* ──────────────────────────────────────────────────────────────────────────── *
 *                         HELPER FUNCTIONS
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Evict the oldest cached file (that is not pending, recent or mounted) to free cache space.
 *
 * @param cachedIds - Array of currently cached file IDs.
 * @param mountedIds - Array of mounted file IDs.
 * @param recentIds - Array of recent file IDs.
 * @param setUri - Function to set URI in storage.
 * @returns The evicted file ID, or null if no candidate can be evicted.
 */
const evictCacheItem = async (
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
  // For simplicity, evict the last/oldest candidate.
  const evictId = candidates[candidates.length - 1];
  assert(evictId);
  await setUri(evictId, undefined);
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
    ? async (id: FileId, data: DataUri | Deleted): Promise<void> => {
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
): ((id: FileId) => Promise<DataUri | null | undefined>) | Disabled =>
  getUrls
    ? async (id: FileId): Promise<DataUri | null | undefined> => {
        const record: Partial<FileRecord> | null = await getUrls({ id });
        if (!record) return undefined; // File record is null

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
          return undefined;
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
        return bufferBin ? getDataUriFromBufferBin(bufferBin) : undefined;
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
  cacheFileIds,
  recentFileIds,
  mountedFileIds,
  setUri,
}: {
  maxCache: number;
  cacheFileIds: FileId[] | Loading;
  recentFileIds: FileId[] | Loading;
  mountedFileIds: FileId[];
  setUri: ManagedUriStorage["setUri"] | Disabled;
}) => {
  useEffect(() => {
    if (
      typeof cacheFileIds !== "object" ||
      typeof recentFileIds !== "object" ||
      !setUri
    ) {
      return; // Wait for lists and storage to be loaded
    }

    const runEviction = async () => {
      if (cacheFileIds.length <= maxCache) return;

      let currentCachedIds = [...cacheFileIds];

      while (currentCachedIds.length > maxCache) {
        const evictedId = await evictCacheItem(
          currentCachedIds,
          mountedFileIds,
          recentFileIds,
          setUri,
        );
        if (!evictedId) {
          log(
            "Cache eviction failed to make space, stopping. Possibly too many mounted or recent files.",
            {
              mounted: mountedFileIds.length,
              recent: recentFileIds.length,
              cached: cacheFileIds.length,
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
  }, [maxCache, cacheFileIds, recentFileIds, mountedFileIds, setUri]);
};

/**
 * Hook to manage live cache loading for mounted items.
 * This hook runs in useEffect within FileCacheProvider and fetches data for mounted IDs if online and not cached.
 */
const useLiveCacheManager = ({
  isOnline,
  mountedFileIds,
  cacheFileIds,
  uploadFileIds,
  downloadFile,
  setUri,
  maxMounted,
}: {
  isOnline: boolean;
  mountedFileIds: FileId[];
  cacheFileIds: FileId[] | Loading;
  uploadFileIds: FileId[] | Loading;
  downloadFile?: (id: FileId) => Promise<DataUri | Deleted | undefined>;
  setUri: ManagedUriStorage["setUri"] | Disabled;
  maxMounted?: number;
}) => {
  // Use a ref to prevent overlapping fetch calls within the same effect execution.
  const isFetchingRef = useRef(false);
  // Ref to track IDs that have been fetched in this session to prevent re-fetching.
  const fetchedIdsRef = useRef<Set<FileId>>(new Set());

  // Prevent fetching already cached, upload pending files, or already fetched in this session, and limit to maxMounted
  const fetchIds = useMemo(() => {
    if (!cacheFileIds || !uploadFileIds) return undefined;
    const cachedSet = new Set(cacheFileIds);
    const uploadSet = new Set(uploadFileIds);
    return maxMounted !== undefined
      ? mountedFileIds.slice(0, maxMounted)
      : mountedFileIds;
  }, [mountedFileIds, maxMounted, cacheFileIds, uploadFileIds]);

  const filteredFetchIds = useMemo(() => {
    if (!Array.isArray(fetchIds)) return [];
    return fetchIds.filter(
      (id) =>
        !(cacheFileIds instanceof Array && cacheFileIds.includes(id)) && // Check if in cache
        !(uploadFileIds instanceof Array && uploadFileIds.includes(id)) && // Check if pending upload
        !fetchedIdsRef.current.has(id), // Check if already fetched in this session
    );
  }, [fetchIds, cacheFileIds, uploadFileIds]);

  useEffect(() => {
    if (
      !isOnline ||
      !Array.isArray(filteredFetchIds) ||
      !setUri ||
      !downloadFile ||
      filteredFetchIds.length === 0
    )
      return;

    const runLiveCache = async () => {
      // If a fetch is already in progress, do not start another.
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      // Only fetch files that are mounted and not in cache or already fetched.
      for (const id of filteredFetchIds) {
        log(`Cache1: Fetching mounted file ${id}...`);
        try {
          const dataUri = await downloadFile(id);
          if (dataUri == undefined) {
            log(`Cache2: No data on server for mounted file ${id}`, {
              filteredFetchIds,
              mountedFileIds,
              cacheFileIds,
              uploadFileIds,
            });
          } else {
            await setUri(id, dataUri);
            fetchedIdsRef.current.add(id); // Mark as fetched in this session
            log(`Cache3: Fetched and cached mounted file ${id}`, {
              filteredFetchIds,
              mountedFileIds,
              cacheFileIds,
              uploadFileIds,
            });
          }
        } catch (error) {
          log(`Cache4: Error fetching mounted file ${id}:`, error);
        }
      }

      // Allow future fetches.
      isFetchingRef.current = false;
    };

    runLiveCache();
  }, [isOnline, filteredFetchIds, downloadFile, setUri]);
};

/**
 * Hook to trigger refresh.
 */
const useClearCacheIds = ({
  cachedFileIds,
  deleteUri,
}: {
  cachedFileIds: FileId[] | Loading;
  deleteUri: ManagedUriStorage["deleteUri"] | Disabled;
}): ((ids?: string[]) => Promise<void>) | undefined =>
  useMemo(
    () =>
      typeof cachedFileIds !== "object" || !deleteUri
        ? undefined
        : async (ids: string[] = cachedFileIds) => {
            log("Start clearing cached files...", {
              count: ids.length,
            });

            for (const id of ids) {
              try {
                await deleteUri(id); // Clear the cache for non-pending files
                log(`Cleared cache for file ${id}`);
              } catch (error) {
                console.error(`Error clearing cache for file ${id}:`, error);
              }
            }
            log("Finished clearing cached files.");
          },
    [cachedFileIds, deleteUri],
  );

/**
 * The provider uses 5 lists:
 *
 * - cached: ids of file binary data cached on disk/in memory
 * - pending: ids of files waiting to be uploaded
 * - error: ids of files that failed upload
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
  maxUploadCache = 10,
  maxUploadErrorCache = 10,
  maxMounted = 10,
  maxRecent = 10,
  isOnline,
  getCacheableIds,
  uploadFile,
  downloadFile,
  cacheStorage,
  uploadStorage,
  uploadErrorStorage,
}: FileCacheProviderProps) => {
  const mountTracker = useMountTracker({ maxMounted, maxRecent });
  const { recent: recentFileIds, mounted: mountedFileIds } = mountTracker;

  const {
    ids: cacheFileIds,
    getUri: getCacheUri,
    setUri: setCacheUri,
    deleteUri: deleteCacheUri,
    reset: resetCacheStorage,
  } = cacheStorage ?? {};

  const {
    ids: uploadFileIds,
    getUri: getUploadUri,
    setUri: setUploadUri,
    deleteUri: deleteUploadUri,
    reset: resetUploadStorage,
  } = uploadStorage ?? {};

  const {
    ids: uploadErrorFileIds,
    getUri: getUploadErrorUri,
    setUri: setUploadErrorUri,
    deleteUri: deleteUploadErrorUri,
    reset: resetUploadErrorStorage,
  } = uploadErrorStorage ?? {};

  log("FileCacheProvider1", {
    mountedFileIds,
    recentFileIds,
    cacheFileIds,
    uploadFileIds,
    uploadErrorFileIds,
  });

  // todo: when full it loops over and over trying to evict
  // useEvictionCacheManager({
  //   maxCache,
  //   cacheFileIds,
  //   recentFileIds,
  //   mountedFileIds,
  //   setUri: setCacheUri,
  // });

  // todo: it may start fetching while sync is in progress, causing double fetch
  // todo: it may cause an infinite render loop in react sometimes
  useLiveCacheManager({
    isOnline,
    mountedFileIds,
    cacheFileIds,
    uploadFileIds,
    downloadFile,
    setUri: setCacheUri,
    maxMounted,
  });

  const refreshNonPending = useClearCacheIds({
    cachedFileIds: cacheFileIds,
    deleteUri: deleteCacheUri,
  });

  /**
   * Synchronize pending files by uploading each one.
   *
   * For each file ID in the pending list, the corresponding DataUri is loaded
   * from upload storage and then uploaded remotely. Upon successful upload,
   * the file data is moved from upload storage to cache storage.
   */
  const syncPendingFiles: ((signal?: AbortSignal) => Promise<void>) | Disabled =
    uploadFileIds &&
    setUploadUri &&
    getUploadUri &&
    uploadFile &&
    setCacheUri &&
    deleteUploadUri &&
    downloadFile &&
    setUploadErrorUri
      ? async (signal?: AbortSignal): Promise<void> => {
          log("Start upload pending list...", { count: uploadFileIds.length });
          for (const id of uploadFileIds) {
            if (signal?.aborted) throw new Error("Upload aborted");

            try {
              const dataUri = await getUploadUri(id);
              if (signal?.aborted) throw new Error("Upload aborted");

              if (dataUri === undefined)
                throw new Error(`Pending file not found in upload storage.`);

              log(`Start upload pending file...`, {
                id,
                size: dataUri?.length ?? null,
              });
              await uploadFile(id, dataUri);
              if (signal?.aborted) throw new Error("Upload aborted");

              // Confirm upload by fetching the file and comparing
              log(`Confirming upload for file ${id}...`);
              const fetchedDataUri = await downloadFile(id);
              if (fetchedDataUri !== dataUri)
                throw new Error(
                  `Confirmation fetch failed: File not found on server after upload.`,
                );
              if (fetchedDataUri?.length !== dataUri?.length)
                throw new Error(
                  `Confirmation fetch failed: File size mismatch after upload.`,
                );

              log(`Upload confirmed for file ${id}.`);

              log(`Finish upload pending file.`, {
                id,
              });
              await setCacheUri(id, dataUri); // Move to cacheStorage after successful upload
              await deleteUploadUri(id); // Clean up uploadStorage after upload & cache
            } catch (error) {
              if (signal?.aborted) throw error;

              log(
                `syncPendingFilesE1: Error upload pending file ${id}: ${error}`,
                { cause: error },
              );
              const dataUri = await getUploadUri(id);
              if (dataUri !== undefined) {
                await setUploadErrorUri(id, dataUri);
                await deleteUploadUri(id);
                log(
                  `syncPendingFilesE2: Moved file ${id} to uploadErrorStorage due to upload failure.`,
                );
              } else {
                log(
                  `syncPendingFilesE3: DataUri not found in uploadStorage for file ${id} after upload failure.`,
                );
              }
              // todo: move the file to a 3rd storage, uploadFailCache
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
    getCacheableIds && cacheFileIds && setCacheUri && downloadFile
      ? async (signal?: AbortSignal) => {
          assert(cacheFileIds);
          assert(mountedFileIds);
          assert(recentFileIds);

          // Start with a copy of the current cached file IDs.
          const cacheableCount = ((maxCache * 3) / 4) | 0;
          let currentCachedIds = [...cacheFileIds];
          const idsToFetch = [
            ...recentFileIds,
            ...((await getCacheableIds(cacheableCount)) ?? []),
          ]
            .filter((id) => !currentCachedIds.includes(id))
            .slice(0, cacheableCount);

          log("Start fetching...", { count: idsToFetch.length });
          for (const id of idsToFetch) {
            if (signal?.aborted) throw new Error("Sync aborted");

            // Check if cache is full
            if (currentCachedIds.length >= maxCache) {
              log(`Try to make space in cacheStorage...`);
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
                    fetchFileId: id,
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
            try {
              if (signal?.aborted) throw new Error("Sync aborted");

              log(`Try to fetch file ${id}...`);
              const dataUri = await downloadFile(id);
              if (signal?.aborted) throw new Error("Sync aborted");

              if (dataUri === null) {
                log(`File ${id} is deleted. Not added to cache.`);
              } else {
                await setCacheUri(id, dataUri);
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
    [syncPendingFiles, syncLatestFiles, mountedFileIds, recentFileIds],
  );

  /**
   * Function to reset the file cache, deleting all cached and pending files and clearing lists.
   */
  const reset = useMemo(
    () =>
      resetCacheStorage && resetUploadStorage && resetUploadErrorStorage
        ? async () => {
            log("FileCache reset started");
            await resetCacheStorage();
            log("Cache UriStorage reset completed");
            await resetUploadStorage();
            log("Upload UriStorage reset completed");
            await resetUploadErrorStorage();
            log("Upload Error UriStorage reset completed");

            mountTracker.reset();
            log("Recent and Mounted IDs cleared");

            log("FileCache reset finished");
          }
        : undefined,
    [resetCacheStorage, resetUploadStorage, resetUploadErrorStorage],
  );

  /**
   * Hook to retrieve a file’s DataUri from the cache.
   *
   * @param fileId - The file identifier.
   * @returns The async state tuple of the file’s DataUri.
   */
  const useItem = (
    fileId?: FileId,
  ): AsyncState<DataUri | null | undefined> | Disabled => {
    const [dataUri, setCacheUri]: AsyncState<DataUri | null | undefined> =
      useManagedUriItem(fileId, cacheStorage) ?? [];
    const [uploadUri, setUploadUri]: AsyncState<DataUri | null | undefined> =
      useManagedUriItem(fileId, uploadStorage) ?? [];
    const [uploadErrorUri]: AsyncState<DataUri | null | undefined> =
      useManagedUriItem(fileId, uploadErrorStorage) ?? [];

    // Register the fileId with the mount tracker.
    // This will automatically update both the mounted and recent lists.
    useMountTrackerItem(mountTracker, fileId);

    // Create a wrapped setter that adds the fileId to the pending list if updated.
    const setItem: AsyncDispatch<DataUri | null | undefined> | undefined =
      useMemo(
        () =>
          fileId !== undefined &&
          setUploadUri &&
          uploadFileIds &&
          uploadFileIds.length < maxUploadCache
            ? async (data) => setUploadUri(data)
            : undefined,
        [fileId, setUploadUri, uploadFileIds, maxUploadCache],
      );
    return [
      uploadErrorUri !== undefined
        ? uploadErrorUri
        : uploadUri !== undefined
          ? uploadUri
          : dataUri,
      setItem,
    ]; // Prioritize error, then upload, then cache
  };

  const getItem = cacheStorage?.getUri;

  /**
   * Hook to retrieve the list of cached file IDs.
   */
  const useCacheList = useCallback(
    (): FileId[] | Loading => cacheFileIds,
    [cacheFileIds],
  );

  /**
   * Hook to retrieve the list of pending file IDs.
   */
  const usePendingList = useCallback(
    (): FileId[] | Loading => uploadFileIds,
    [uploadFileIds],
  );

  /**
   * Hook to retrieve the list of error file IDs.
   */
  const useErrorList = useCallback(
    (): FileId[] | Loading => uploadErrorFileIds,
    [uploadErrorFileIds],
  );

  /**
   * Hook to retrieve the list of recent file IDs.
   */
  const useRecentList = useCallback(
    (): FileId[] | Loading => recentFileIds,
    [recentFileIds],
  );

  const value = useMemo(
    () => ({
      useItem,
      getItem,
      useCacheList,
      usePendingList,
      useErrorList,
      useRecentList,
      sync,
      reset,
      refreshNonPending,
    }),
    [
      useItem,
      getItem,
      useCacheList,
      usePendingList,
      useErrorList,
      useRecentList,
      sync,
      reset,
      refreshNonPending,
    ],
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
): AsyncState<DataUri | null | undefined> | Disabled => {
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
 * Hook to access the error file IDs.
 *
 * @returns Array of error file IDs.
 */
export const useErrorFileIds = (): FileId[] | Loading =>
  useContext(FileCacheContext).useErrorList();

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
 * Hook to trigger file cache refresh of non-pending files.
 *
 * @returns The refreshNonPending function.
 */
export const useFileCacheClear = () => {
  const { refreshNonPending } = useFileCache();
  return refreshNonPending;
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
