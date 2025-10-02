/**
 * @module fileCache/provider
 *
 * This module defines the FileCacheProvider, which exposes an API for
 * retrieving file data URIs from a local cache, synchronizing pending uploads,
 * and refreshing the cache from the remote source.
 */

import { ApiSetList, useLocal } from "@dwidge/crud-api-react";
import {
  AsyncDispatch,
  AsyncState,
  getActionValue,
  Json,
  useConvert,
  useJson,
} from "@dwidge/hooks-react";
import assert from "assert";
import { AxiosInstance } from "axios";
import pLimit from "p-limit";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import {
  getDataUriFromBufferBin,
  getMetaBufferFromDataUri,
  getMimeTypeFromDataUri,
  getSha256HexFromDataUri,
  getSizeFromDataUri,
  MetaNull,
} from "./uri.js";
import { ManagedUriStorage, useManagedUriItem } from "./useLocalUri.js";
import { useMountTracker, useMountTrackerItem } from "./useMountTracker.js";

const log = (...args) => {};

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
   * Hook to get a list of recently used file IDs.
   */
  useRecentList: () => FileId[] | Loading;
  /**
   * Hook to get a list of file IDs that are missing on the server (404).
   * These are files with non null meta data but have not yet been uploaded.
   */
  useMissingList: () => FileId[] | Loading;
  /**
   * Hook to get cache errors record.
   */
  useCacheErrors: () => Record<FileId, string>;
  /**
   * Hook to get upload errors record.
   */
  useUploadErrors: () => Record<FileId, string>;
  /**
   * Function to retrieve file record/metadata for a file ID.
   */
  getFileRecord?: (id: FileId) => Promise<MetaNull | null>;
  /**
   * Function to retrieve signed URLs for a file ID.
   */
  getSignedUrls?: (
    id: FileId,
  ) => Promise<Pick<FileRecord, "getUrl" | "putUrl"> | null>;

  setFiles?: ApiSetList<FileRecord, { id: string }>;
  /**
   * Function to manually upload a file by ID and data URI.
   */
  uploadFile?: (id: FileId, data: DataUri) => Promise<void>;
  /**
   * Trigger a sync operation to upload pending files from cache and download speculative files to cache.
   * @param options - Optional parameters: an AbortSignal and a progress notifier.
   * @returns A promise that resolves when the sync operation is complete.
   */
  sync?: (options?: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    pull?: boolean;
    concurrency?: number;
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
  /**
   * Clear a specific cache error.
   */
  clearCacheError?: (id: FileId) => void;
  /**
   * Clear a specific upload error.
   */
  clearUploadError?: (id: FileId) => void;
};

export const FileCacheContext = createContext<FileCache>({
  useItem: () => [null, undefined],
  getItem: async () => null,
  useCacheList: () => [],
  usePendingList: () => [],
  useErrorList: () => [],
  useRecentList: () => [],
  useMissingList: () => [],
  useCacheErrors: () => ({}),
  useUploadErrors: () => ({}),
  getFileRecord: undefined,
  getSignedUrls: undefined,
  uploadFile: async () => {},
  sync: async () => {},
  reset: async () => {},
  refreshNonPending: async () => {},
  clearCacheError: () => {},
  clearUploadError: () => {},
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
  /** Maximum number of concurrent file sync operations. */
  maxConcurrentFiles?: number;
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
  /**
   * Function to retrieve file record/metadata for a file ID.
   */
  getFileRecord?: (id: FileId) => Promise<MetaNull | null>;
  /**
   * Function to retrieve signed URLs for a file ID.
   */
  getSignedUrls?: (
    id: FileId,
  ) => Promise<Pick<FileRecord, "getUrl" | "putUrl"> | null>;

  setFiles?: ApiSetList<FileRecord, { id: string }>;

  cacheStorage?: ManagedUriStorage;
  uploadStorage?: ManagedUriStorage;
  uploadErrorStorage?: ManagedUriStorage;
};

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
    : updatedRecentIds;
};

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
          log(
            `File ${id} marked for deletion; not implemented, skipping upload.`,
          );
          return;
        }
        const file = await getMetaBufferFromDataUri(data);
        if (!file)
          throw new Error(
            `useUploadFileIdE1: Unable to process data for file ${id}`,
            { cause: { id } },
          );

        const { meta, buffer } = file;
        const fileRecord = await getUrls({ id });
        const { getUrl, putUrl } = fileRecord ?? {};
        if (putUrl && getUrl) {
          log(`Uploading file ${id}`);
          await putBufferToUrlAndVerify({
            data: buffer,
            putUrl,
            getUrl,
            meta,
            axios,
          });
        } else if (getUrl) {
          log(`Confirming file ${id}`);
          await getBufferFromUrlAndVerify({ getUrl, meta, axios });
        } else {
          log(`Can't upload file ${id}`, fileRecord);
          throw new Error(
            `useUploadFileIdE2: Missing upload URLs for file ${id}`,
            {
              cause: { id, urls: { getUrl, putUrl } },
            },
          );
        }

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
        if (!record)
          throw new Error(
            `useDownloadFileIdE2: No record/meta found for file id ${id}`,
            { cause: { id } },
          );

        if (
          record.size === null &&
          record.mime === null &&
          record.sha256 === null
        )
          return null;

        if (record.size == null || record.mime == null || record.sha256 == null)
          throw new Error(
            `useDownloadFileIdE1: Incomplete file meta for file ${id}`,
            { cause: { fileMeta: record } },
          );

        if (!record.getUrl)
          throw new Error(
            `useDownloadFileIdE3: No download URL available for file id ${id}`,
            { cause: { id } },
          );

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
      return;
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
          break;
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
  setCacheErrors,
  setMissingFileIds,
}: {
  isOnline: boolean;
  mountedFileIds: FileId[];
  cacheFileIds: FileId[] | Loading;
  uploadFileIds: FileId[] | Loading;
  downloadFile?: (id: FileId) => Promise<DataUri | Deleted | undefined>;
  setUri: ManagedUriStorage["setUri"] | Disabled;
  maxMounted?: number;
  setCacheErrors: React.Dispatch<React.SetStateAction<Record<FileId, string>>>;
  setMissingFileIds: React.Dispatch<React.SetStateAction<FileId[]>>;
}) => {
  const isFetchingRef = useRef(false);
  const fetchedIdsRef = useRef<Set<FileId>>(new Set());

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
        !(cacheFileIds instanceof Array && cacheFileIds.includes(id)) &&
        !(uploadFileIds instanceof Array && uploadFileIds.includes(id)) &&
        !fetchedIdsRef.current.has(id),
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
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      for (const id of filteredFetchIds) {
        log(`Cache1: Fetching mounted file ${id}...`);
        try {
          const dataUri = await downloadFile(id);
          if (dataUri === undefined) {
            log(`Cache2: No data on server for mounted file ${id}`, {
              filteredFetchIds,
              mountedFileIds,
              cacheFileIds,
              uploadFileIds,
            });
            setMissingFileIds((prev) => [...new Set([...prev, id])]);
          } else if (dataUri === null) {
            await setUri(id, null);
            fetchedIdsRef.current.add(id);
            setMissingFileIds((prev) => prev.filter((p) => p !== id));
            log(`Cache2: File deleted on server for mounted file ${id}`);
          } else {
            await setUri(id, dataUri);
            fetchedIdsRef.current.add(id);
            setMissingFileIds((prev) => prev.filter((p) => p !== id));
            log(`Cache3: Fetched and cached mounted file ${id}`, {
              filteredFetchIds,
              mountedFileIds,
              cacheFileIds,
              uploadFileIds,
            });
          }
        } catch (error: unknown) {
          log(`Cache4: Error fetching mounted file ${id}:`, error);
          setCacheErrors((prev) => ({
            ...prev,
            [id]: `${error}` || "Unknown error",
          }));
        }
      }

      isFetchingRef.current = false;
    };

    runLiveCache();
  }, [
    isOnline,
    filteredFetchIds,
    downloadFile,
    setUri,
    setCacheErrors,
    setMissingFileIds,
    mountedFileIds,
    cacheFileIds,
    uploadFileIds,
  ]);
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
                await deleteUri(id);
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
  maxConcurrentFiles = 1,
  isOnline,
  getCacheableIds,
  uploadFile,
  downloadFile,
  getFileRecord,
  getSignedUrls,
  setFiles,
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

  const [cacheErrors, setCacheErrors] = useState<Record<FileId, string>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<FileId, string>>({});
  const [missingFileIds, setMissingFileIds] = useState<FileId[]>([]);

  const {
    ids: uploadErrorFileIds,
    getUri: getUploadErrorUri,
    setUri: setUploadErrorUri,
    deleteUri: deleteUploadErrorUri,
    reset: resetUploadErrorStorage,
  } = uploadErrorStorage ?? {};

  useEffect(() => {
    const migrateOldErrors = async () => {
      if (!uploadErrorFileIds || uploadErrorFileIds.length === 0) return;

      log(
        `Migrating ${uploadErrorFileIds.length} old upload errors to upload cache...`,
      );
      for (const id of uploadErrorFileIds) {
        try {
          const errorUri = await getUploadErrorUri?.(id);
          if (errorUri !== undefined) {
            await setUploadUri?.(id, errorUri);
            await deleteUploadErrorUri?.(id);
            setUploadErrors((prev) => ({
              ...prev,
              [id]: "Moved from the error cache to upload cache, ready to upload next time",
            }));
            log(`Migrated file ${id} from error cache to upload cache.`);
          }
        } catch (error: any) {
          log(`Error migrating file ${id}:`, error);
        }
      }
      log("Migration completed.");
    };

    migrateOldErrors();
  }, [
    uploadErrorFileIds,
    getUploadErrorUri,
    setUploadUri,
    deleteUploadErrorUri,
  ]);

  log("FileCacheProvider1", {
    mountedFileIds,
    recentFileIds,
    cacheFileIds,
    uploadFileIds,
    uploadErrorFileIds,
    missingFileIds,
  });

  useLiveCacheManager({
    isOnline,
    mountedFileIds,
    cacheFileIds,
    uploadFileIds,
    downloadFile,
    setUri: setCacheUri,
    maxMounted,
    setCacheErrors,
    setMissingFileIds,
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
  const syncPendingFiles:
    | ((signal?: AbortSignal, concurrency?: number) => Promise<void>)
    | Disabled =
    uploadFileIds &&
    setUploadUri &&
    getUploadUri &&
    uploadFile &&
    setCacheUri &&
    deleteUploadUri &&
    downloadFile &&
    setUploadErrorUri
      ? async (signal, concurrency = 1): Promise<void> => {
          log("Start upload pending list...", { count: uploadFileIds.length });

          const limit = pLimit(concurrency);
          const promises = uploadFileIds.map((id) =>
            limit(async () => {
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
                await setCacheUri(id, dataUri);
                await deleteUploadUri(id);
                setMissingFileIds((prev) => prev.filter((p) => p !== id));
                setUploadErrors((prev) => {
                  const newErrors = { ...prev };
                  delete newErrors[id];
                  return newErrors;
                });
              } catch (error: unknown) {
                if (signal?.aborted) throw error;

                log(
                  `syncPendingFilesE1: Error upload pending file ${id}: ${error}`,
                  { cause: error },
                );
                setUploadErrors((prev) => ({
                  ...prev,
                  [id]: `${error}` || "Unknown upload error",
                }));
                const dataUri = await getUploadUri(id);
                if (dataUri === undefined) {
                  log(
                    `syncPendingFilesE21: DataUri not found in uploadStorage for file ${id} after upload failure.`,
                  );
                } else if (dataUri === null) {
                  log(
                    `syncPendingFilesE22: DataUri found in uploadStorage for file ${id} (null) after upload failure.`,
                  );
                } else {
                  log(
                    `syncPendingFilesE23: DataUri found in uploadStorage for file ${id} (length ${getSizeFromDataUri(dataUri)}) after upload failure.`,
                  );
                }

                const enhancedError =
                  error instanceof Error ? error : new Error(`${error}`);
                enhancedError.message = `File ${id}: ${enhancedError.message}`;
                enhancedError.name = `UploadError`;
                throw enhancedError;
              }
            }),
          );

          log("Finish upload pending list.");

          const results = await Promise.allSettled(promises);
          const errors = results
            .filter((result) => result.status === "rejected")
            .map((result) => (result as PromiseRejectedResult).reason);
          if (errors.length > 0) {
            const aggregateError = new AggregateError(
              errors,
              "One or more uploads failed",
            );
            throw aggregateError;
          }
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
  const syncLatestFiles:
    | ((signal?: AbortSignal, concurrency?: number) => Promise<void>)
    | Disabled =
    getCacheableIds && cacheFileIds && setCacheUri && downloadFile
      ? async (signal, concurrency = 1) => {
          assert(cacheFileIds);
          assert(mountedFileIds);
          assert(recentFileIds);

          const cacheableCount = ((maxCache * 3) / 4) | 0;
          let currentCachedIds = [...cacheFileIds];
          const idsToFetch = [
            ...recentFileIds,
            ...((await getCacheableIds(cacheableCount)) ?? []),
          ]
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
            log(
              `Try to make space in cacheStorage by evicting ${numToEvict} items...`,
            );
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

          const limit = pLimit(concurrency);
          const promises = finalIdsToFetch.map((id) =>
            limit(async () => {
              if (signal?.aborted) throw new Error("Sync aborted");

              try {
                log(`Try to fetch file ${id}...`);
                const dataUri = await downloadFile(id);
                if (signal?.aborted) throw new Error("Sync aborted");

                if (dataUri === undefined) {
                  log(`File ${id} not found on server. Adding to missing.`);
                  setMissingFileIds((prev) => [...new Set([...prev, id])]);
                } else if (dataUri === null) {
                  log(`File ${id} is deleted. Not added to cache.`);
                  setMissingFileIds((prev) => prev.filter((p) => p !== id));
                } else {
                  await setCacheUri(id, dataUri);
                  currentCachedIds.push(id);
                  setMissingFileIds((prev) => prev.filter((p) => p !== id));
                  log(`File ${id} fetched and cached.`);
                  setCacheErrors((prev) => {
                    const newErrors = { ...prev };
                    delete newErrors[id];
                    return newErrors;
                  });
                }
              } catch (error: unknown) {
                if (signal?.aborted) throw error;

                log(
                  `syncLatestFilesE2: Error refreshing cache for file ${id}: ${error}`,
                  { cause: error },
                );
                setCacheErrors((prev) => ({
                  ...prev,
                  [id]: `${error}` || "Unknown fetch error",
                }));

                const enhancedError =
                  error instanceof Error ? error : new Error(`${error}`);
                enhancedError.message = `File ${id}: ${enhancedError.message}`;
                enhancedError.name = `DownloadError`;
                throw enhancedError;
              }
            }),
          );

          log("Finish fetching.");

          const results = await Promise.allSettled(promises);
          const errors = results
            .filter((result) => result.status === "rejected")
            .map((result) => (result as PromiseRejectedResult).reason);
          if (errors.length > 0) {
            const aggregateError = new AggregateError(
              errors,
              "One or more downloads failed",
            );
            throw aggregateError;
          }
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
            concurrency?: number;
          }) => {
            log("Sync started");
            const signal = options?.signal;
            const concurrency = options?.concurrency ?? maxConcurrentFiles;
            if (signal?.aborted) throw new Error("Sync aborted");

            const totalTasks = 2;
            let completedTasks = 0;
            const reportProgress = () => {
              if (options?.onProgress) {
                const progress = completedTasks / totalTasks;
                options.onProgress(progress);
              }
            };

            await syncPendingFiles(signal, concurrency);
            if (signal?.aborted) throw new Error("Sync aborted");

            completedTasks++;
            reportProgress();
            if (options?.pull !== false)
              await syncLatestFiles(signal, concurrency);
            if (signal?.aborted) throw new Error("Sync aborted");

            completedTasks++;
            reportProgress();
            log("Sync finished");
          }
        : undefined,
    [
      syncPendingFiles,
      syncLatestFiles,
      mountedFileIds,
      recentFileIds,
      maxConcurrentFiles,
    ],
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

            setCacheErrors({});
            setUploadErrors({});
            setMissingFileIds([]);

            log("FileCache reset finished");
          }
        : undefined,
    [resetCacheStorage, resetUploadStorage, resetUploadErrorStorage],
  );

  /**
   * Clear a specific cache error.
   */
  const clearCacheError = useCallback((id: FileId) => {
    setCacheErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[id];
      return newErrors;
    });
  }, []);

  /**
   * Clear a specific upload error.
   */
  const clearUploadError = useCallback((id: FileId) => {
    setUploadErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[id];
      return newErrors;
    });
  }, []);

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

    useMountTrackerItem(mountTracker, fileId);

    /**
     * Verify data URI against file metadata.
     */
    const verifyDataUriAgainstMeta = useCallback(
      async (
        dataUri: DataUri | null | undefined,
        fileMeta: MetaNull | null,
      ): Promise<DataUri | null | undefined> => {
        if (dataUri) {
          if (!fileMeta)
            throw new Error("verifyDataUriAgainstMetaE1: Missing fileMeta");

          if (fileMeta.mime !== null) {
            const dataMime = getMimeTypeFromDataUri(dataUri);
            if (dataMime !== fileMeta.mime) {
              throw new Error(
                `verifyDataUriAgainstMetaE2: MIME mismatch: expected ${fileMeta.mime}, got ${dataMime}`,
              );
            }
          }

          if (fileMeta.size !== null) {
            const dataSize = getSizeFromDataUri(dataUri);
            if (dataSize !== fileMeta.size) {
              throw new Error(
                `verifyDataUriAgainstMetaE3: Size mismatch: expected ${fileMeta.size}, got ${dataSize}`,
              );
            }
          }

          if (fileMeta.sha256 !== null) {
            const dataSha = await getSha256HexFromDataUri(dataUri);
            if (dataSha !== fileMeta.sha256) {
              throw new Error(
                `verifyDataUriAgainstMetaE4: SHA256 mismatch: expected ${fileMeta.sha256}, got ${dataSha}`,
              );
            }
          }
        }

        return dataUri;
      },
      [],
    );

    const setItem: AsyncDispatch<DataUri | null | undefined> | undefined =
      useMemo(
        () =>
          fileId !== undefined &&
          setUploadUri &&
          getFileRecord &&
          uploadFileIds &&
          uploadFileIds.length < maxUploadCache
            ? async (data) =>
                setUploadUri(
                  await verifyDataUriAgainstMeta(
                    await getActionValue(data, null),
                    await getFileRecord(fileId),
                  ),
                )
            : undefined,
        [
          fileId,
          setUploadUri,
          uploadFileIds,
          maxUploadCache,
          getFileRecord,
          verifyDataUriAgainstMeta,
        ],
      );

    return [
      uploadErrorUri !== undefined
        ? uploadErrorUri
        : uploadUri !== undefined
          ? uploadUri
          : dataUri,
      setItem,
    ];
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

  /**
   * Hook to retrieve the list of missing file IDs.
   */
  const useMissingList = useCallback(
    (): FileId[] | Loading => missingFileIds,
    [missingFileIds],
  );

  /**
   * Hook to get cache errors.
   */
  const useCacheErrors = useCallback(() => cacheErrors, [cacheErrors]);

  /**
   * Hook to get upload errors.
   */
  const useUploadErrors = useCallback(() => uploadErrors, [uploadErrors]);

  const value = useMemo(
    () => ({
      useItem,
      getItem,
      useCacheList,
      usePendingList,
      useErrorList,
      useRecentList,
      useMissingList,
      useCacheErrors,
      useUploadErrors,
      getFileRecord,
      getSignedUrls,
      setFiles,
      uploadFile,
      sync,
      reset,
      refreshNonPending,
      clearCacheError,
      clearUploadError,
    }),
    [
      useItem,
      getItem,
      useCacheList,
      usePendingList,
      useErrorList,
      useRecentList,
      useMissingList,
      useCacheErrors,
      useUploadErrors,
      getFileRecord,
      getSignedUrls,
      setFiles,
      uploadFile,
      sync,
      reset,
      refreshNonPending,
      clearCacheError,
      clearUploadError,
    ],
  );

  return (
    <FileCacheContext.Provider value={value}>
      {children}
    </FileCacheContext.Provider>
  );
};

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
 * Hook to access the cached file IDs.
 *
 * @returns Array of cached file IDs.
 */
export const useCacheFileIds = (): FileId[] | Loading =>
  useFileCache().useCacheList();

/**
 * Hook to access the recent file IDs.
 *
 * @returns Array of recent file IDs.
 */
export const useRecentFileIds = (): FileId[] | Loading =>
  useFileCache().useRecentList();

/**
 * Hook to access the missing file IDs.
 *
 * @returns Array of missing file IDs.
 */
export const useMissingFileIds = (): FileId[] | Loading =>
  useFileCache().useMissingList();

/**
 * Hook to access cache errors.
 *
 * @returns The cache errors record.
 */
export const useCacheErrorsRecord = (): Record<FileId, string> =>
  useFileCache().useCacheErrors();

/**
 * Hook to access upload errors.
 *
 * @returns The upload errors record.
 */
export const useUploadErrorsRecord = (): Record<FileId, string> =>
  useFileCache().useUploadErrors();

export const useGetFileRecord = () => useFileCache().getFileRecord;
export const useGetSignedUrls = () => useFileCache().getSignedUrls;

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
 * Hook to clear a cache error.
 *
 * @returns The clearCacheError function.
 */
export const useClearCacheError = () => {
  const { clearCacheError } = useFileCache();
  return clearCacheError;
};

/**
 * Hook to clear an upload error.
 *
 * @returns The clearUploadError function.
 */
export const useClearUploadError = () => {
  const { clearUploadError } = useFileCache();
  return clearUploadError;
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
