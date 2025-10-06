/**
 * @module fileCache/provider
 *
 * This module defines the FileCacheProvider, which exposes an API for
 * retrieving file data URIs from a local cache, synchronizing pending uploads,
 * and refreshing the cache from the remote source.
 */

import { ApiSetList } from "@dwidge/crud-api-react";
import { AsyncDispatch, AsyncState, getActionValue } from "@dwidge/hooks-react";
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
import { evictCacheItem } from "./evictCacheItem.js";
import { log } from "./log.js";
import { setCacheError } from "./setCacheError.js";
import { setMissingId } from "./setMissingId.js";
import { syncLatestFiles } from "./syncLatestFiles.js";
import { syncPendingFiles } from "./syncPendingFiles.js";
import {
  DataUri,
  Deleted,
  Disabled,
  FileId,
  FileRecord,
  Loading,
} from "./types.js";
import {
  getMimeTypeFromDataUri,
  getSha256HexFromDataUri,
  getSizeFromDataUri,
  MetaNull,
} from "./uri.js";
import { ManagedUriStorage, useManagedUriItem } from "./useLocalUri.js";
import { useMountTracker, useMountTrackerItem } from "./useMountTracker.js";

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
   * List of file IDs in the cache.
   */
  cacheIds: FileId[] | Loading;
  /**
   * List of file IDs in the cache that are pending upload.
   */
  pendingIds: FileId[] | Loading;
  /**
   * List of file IDs in the cache that are in error during upload.
   */
  errorIds: FileId[] | Loading;
  /**
   * List of recently used file IDs.
   */
  recentIds: FileId[] | Loading;
  /**
   * List of file IDs that are missing on the server (404).
   * These are files with non null meta data but have not yet been uploaded.
   */
  missingIds: FileId[] | Loading;
  /**
   * Cache errors record.
   */
  cacheErrors: Record<FileId, string>;
  /**
   * Upload errors record.
   */
  uploadErrors: Record<FileId, string>;
  /**
   * Function to retrieve file record/metadata for file IDs.
   */
  getFileRecord?: (ids: FileId[]) => Promise<(MetaNull | null)[]>;
  /**
   * Function to retrieve signed URLs for file IDs.
   */
  getSignedUrls?: (
    ids: FileId[],
  ) => Promise<
    (Pick<
      FileRecord,
      "getUrl" | "putUrl" | "id" | "size" | "mime" | "sha256"
    > | null)[]
  >;

  pickFileUri?: () => Promise<string[]>;

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
  cacheIds: [],
  pendingIds: [],
  errorIds: [],
  recentIds: [],
  missingIds: [],
  cacheErrors: {},
  uploadErrors: {},
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
   * Function to retrieve file record/metadata for file IDs.
   */
  getFileRecord?: (ids: FileId[]) => Promise<(MetaNull | null)[]>;
  /**
   * Function to retrieve signed URLs for file IDs.
   */
  getSignedUrls?: (
    ids: FileId[],
  ) => Promise<
    (Pick<
      FileRecord,
      "getUrl" | "putUrl" | "id" | "size" | "mime" | "sha256"
    > | null)[]
  >;

  pickFileUri?: () => Promise<string[]>;

  setFiles?: ApiSetList<FileRecord, { id: string }>;

  cacheStorage?: ManagedUriStorage;
  uploadStorage?: ManagedUriStorage;
  uploadErrorStorage?: ManagedUriStorage;
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
            setMissingFileIds(setMissingId(id, true));
          } else {
            if (dataUri === null) {
              await setUri(id, null);
              fetchedIdsRef.current.add(id);
              log(`Cache2: File deleted on server for mounted file ${id}`);
            } else {
              await setUri(id, dataUri);
              fetchedIdsRef.current.add(id);
              log(`Cache3: Fetched and cached mounted file ${id}`, {
                filteredFetchIds,
                mountedFileIds,
                cacheFileIds,
                uploadFileIds,
              });
            }
            setMissingFileIds(setMissingId(id, false));
          }
          setCacheErrors(setCacheError(id, null));
        } catch (error: unknown) {
          log(`Cache4: Error fetching mounted file ${id}:`, error);
          setCacheErrors(setCacheError(id, `${error}`));
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
  pickFileUri,
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
  const sync = useMemo(() => {
    const canSyncPending =
      uploadFileIds &&
      getUploadUri &&
      uploadFile &&
      downloadFile &&
      setCacheUri &&
      deleteUploadUri;

    const canSyncLatest =
      getCacheableIds && cacheFileIds && downloadFile && setCacheUri;

    if (!canSyncPending || !canSyncLatest) {
      return undefined;
    }

    return async (options?: {
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

      await syncPendingFiles({
        uploadFileIds,
        getUploadUri,
        uploadFile,
        downloadFile,
        setCacheUri,
        deleteUploadUri,
        setUploadErrors,
        signal,
        concurrency,
      });
      if (signal?.aborted) throw new Error("Sync aborted");

      completedTasks++;
      reportProgress();
      if (options?.pull !== false)
        await syncLatestFiles({
          getCacheableIds,
          cacheFileIds,
          downloadFile,
          setCacheUri,
          maxCache,
          mountedFileIds,
          recentFileIds,
          setMissingFileIds,
          setCacheErrors,
          signal,
          concurrency,
        });
      if (signal?.aborted) throw new Error("Sync aborted");

      completedTasks++;
      reportProgress();
      log("Sync finished");
    };
  }, [
    uploadFileIds,
    getUploadUri,
    uploadFile,
    downloadFile,
    setCacheUri,
    deleteUploadUri,
    setUploadErrors,
    getCacheableIds,
    cacheFileIds,
    maxCache,
    mountedFileIds,
    recentFileIds,
    setMissingFileIds,
    setCacheErrors,
    maxConcurrentFiles,
  ]);

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
            ? async (data) => {
                const r = await setUploadUri(
                  await verifyDataUriAgainstMeta(
                    await getActionValue(data, null),
                    (await getFileRecord([fileId]))?.[0] ?? null,
                  ),
                );
                clearUploadError(fileId);
                clearCacheError(fileId);
                return r;
              }
            : undefined,
        [
          fileId,
          setUploadUri,
          uploadFileIds,
          maxUploadCache,
          getFileRecord,
          verifyDataUriAgainstMeta,
          clearUploadError,
          clearCacheError,
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

  const value = useMemo(
    () => ({
      useItem,
      getItem,
      cacheIds: cacheFileIds,
      pendingIds: uploadFileIds,
      errorIds: uploadErrorFileIds,
      recentIds: recentFileIds,
      missingIds: missingFileIds,
      cacheErrors,
      uploadErrors,
      getFileRecord,
      getSignedUrls,
      pickFileUri,
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
      cacheFileIds,
      uploadFileIds,
      uploadErrorFileIds,
      recentFileIds,
      missingFileIds,
      cacheErrors,
      uploadErrors,
      getFileRecord,
      getSignedUrls,
      pickFileUri,
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
export const useFileCache = (): FileCache => useContext(FileCacheContext);

/**
 * Hook to access a file’s DataUri.
 *
 * @param fileId - The file identifier.
 * @returns The async state tuple of the file’s DataUri.
 */
export const useFileUri = (
  fileId?: FileId,
): AsyncState<DataUri | null | undefined> | Disabled =>
  useFileCache().useItem(fileId);

/**
 * Hook to trigger file cache synchronization.
 *
 * @returns The sync function.
 */
export const useFileCacheSync = () => useFileCache().sync;

/**
 * Hook to trigger file cache reset.
 *
 * @returns The reset function.
 */
export const useFileCacheReset = () => useFileCache().reset;

/**
 * Hook to trigger file cache refresh of non-pending files.
 *
 * @returns The refreshNonPending function.
 */
export const useFileCacheClear = () => useFileCache().refreshNonPending;
