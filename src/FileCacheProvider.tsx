import { ApiGetList, ApiSetList } from "@dwidge/crud-api-react";
import { AsyncDispatch, AsyncState, getActionValue } from "@dwidge/hooks-react";
import { AxiosInstance } from "axios";
import { PropsWithChildren } from "react";
import {
  FileCacheProvider,
  useDownloadFileId,
  useFileCache,
  useFileUri,
  useUploadFileId,
} from "./provider";
import { DataUri, Disabled, FileId, FileRecord } from "./types";
import { getMetaBufferFromDataUri } from "./uri";
import { useManagedUriStorage } from "./useLocalUri";
import { usePlatformLocalStorage } from "./usePlatformLocalStorage";

/**
 * Hook to get signed URLs for a file.
 *
 * @param getFile - Function to retrieve a file’s metadata from api.
 * @returns A function that returns the signed URLs.
 */
const useGetUrls = (getFiles?: ApiGetList<FileRecord>) =>
  getFiles
    ? async (
        filter: Pick<FileRecord, "id">,
      ): Promise<Pick<FileRecord, "putUrl" | "getUrl"> | null> => {
        return (
          (await getFiles(filter, { columns: ["getUrl", "putUrl"] }))?.[0] ??
          null
        );
      }
    : undefined;

const useGetCacheableIds = (getFiles?: ApiGetList<FileRecord>) =>
  getFiles
    ? async (maxItemsToCache: number): Promise<FileId[] | undefined> => {
        const files = await getFiles(
          { size: { $not: null } },
          {
            columns: ["id", "updatedAt"],
            order: [["updatedAt", "DESC"]],
            limit: maxItemsToCache,
          },
        );
        return files?.map((v) => v.id);
      }
    : undefined;

export const FileCacheProvider2 = ({
  children,
  maxCache,
  maxRecent,
  maxUploadCache,
  cachePath,
  uploadCachePath,
  isOnline,
  axios,
  getFilesLocal,
  getFiles,
  setFiles,
}: PropsWithChildren<{
  maxCache: number;
  maxRecent: number;
  maxUploadCache?: number;
  cachePath?: string;
  uploadCachePath?: string;
  isOnline: boolean;
  axios?: AxiosInstance;
  getFilesLocal?: ApiGetList<FileRecord>;
  getFiles?: ApiGetList<FileRecord>;
  setFiles?: ApiSetList<FileRecord, { id: string }>;
}>) => {
  return (
    <FileCacheProvider
      maxCache={maxCache}
      maxUploadCache={maxUploadCache}
      maxRecent={maxRecent}
      isOnline={isOnline}
      getCacheableIds={useGetCacheableIds(getFilesLocal)}
      uploadFile={useUploadFileId(useGetUrls(getFiles), axios)}
      downloadFile={useDownloadFileId(useGetUrls(getFiles), axios)}
      cacheStorage={useManagedUriStorage(usePlatformLocalStorage(cachePath))}
      uploadStorage={useManagedUriStorage(
        usePlatformLocalStorage(uploadCachePath),
      )}
    >
      {children}
    </FileCacheProvider>
  );
};

/**
 * Hook to access a file’s DataUri.
 *
 * @param fileId - The file identifier.
 * @returns The async state tuple of the file’s DataUri.
 */
export const useFileCache2Uri = (
  fileId: FileId | Disabled,
  { setFiles }: { setFiles?: ApiSetList<FileRecord, { id: string }> } = {},
): AsyncState<DataUri | null> | Disabled => {
  const [uri, setUri] = useFileUri(fileId) ?? [];
  const setMetaUri: AsyncDispatch<DataUri | null> | undefined =
    setUri && setFiles
      ? async (uri) => {
          const resolvedUri = await getActionValue(uri, null);
          if (resolvedUri !== undefined) {
            const mb = await getMetaBufferFromDataUri(resolvedUri);
            const meta = mb
              ? mb.meta
              : { size: null, mime: null, sha256: null };
            // console.log("setMeta1", meta, resolvedUri?.length ?? null);
            // Update meta data of the file
            await setFiles([{ id: fileId, ...meta }]);
          }
          // Update the data cache
          return (await setUri(resolvedUri)) ?? null;
        }
      : undefined;
  return [uri, setMetaUri];
};

export const useGetFileCache2Uri = () => useFileCache().getItem;
