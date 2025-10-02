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
import { getMetaBufferFromDataUri, MetaNull } from "./uri";
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

const useGetUrlsById = (getFiles?: ApiGetList<FileRecord>) =>
  getFiles
    ? async (
        id: FileId,
      ): Promise<Pick<FileRecord, "putUrl" | "getUrl"> | null> => {
        return (
          (await getFiles({ id }, { columns: ["getUrl", "putUrl"] }))?.[0] ??
          null
        );
      }
    : undefined;

const useGetMeta = (getFiles?: ApiGetList<FileRecord>) =>
  getFiles
    ? async (id: string): Promise<MetaNull | null> => {
        return (
          (
            await getFiles({ id }, { columns: ["mime", "size", "sha256"] })
          )?.[0] ?? null
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
  pickFileUri,
  maxCache,
  maxRecent,
  maxUploadCache,
  maxUploadErrorCache,
  cachePath,
  uploadCachePath,
  uploadErrorCachePath,
  isOnline,
  axios,
  getFilesLocal,
  getFiles,
  setFiles,
}: PropsWithChildren<{
  pickFileUri?: () => Promise<string[]>;
  maxCache: number;
  maxRecent: number;
  maxUploadCache?: number;
  maxUploadErrorCache?: number;
  cachePath?: string;
  uploadCachePath?: string;
  uploadErrorCachePath?: string;
  isOnline: boolean;
  axios?: AxiosInstance;
  getFilesLocal?: ApiGetList<FileRecord>;
  getFiles?: ApiGetList<FileRecord>;
  setFiles?: ApiSetList<FileRecord, { id: string }>;
}>) => {
  return (
    <FileCacheProvider
      pickFileUri={pickFileUri}
      maxCache={maxCache}
      maxUploadCache={maxUploadCache}
      maxUploadErrorCache={maxUploadErrorCache}
      maxRecent={maxRecent}
      isOnline={isOnline}
      getCacheableIds={useGetCacheableIds(getFilesLocal)}
      uploadFile={useUploadFileId(useGetUrls(getFiles), axios)}
      downloadFile={useDownloadFileId(useGetUrls(getFiles), axios)}
      cacheStorage={useManagedUriStorage(usePlatformLocalStorage(cachePath))}
      uploadStorage={useManagedUriStorage(
        usePlatformLocalStorage(uploadCachePath),
      )}
      uploadErrorStorage={useManagedUriStorage(
        usePlatformLocalStorage(uploadErrorCachePath),
      )}
      getFileRecord={useGetMeta(getFilesLocal)}
      getSignedUrls={useGetUrlsById(getFiles)}
      setFiles={setFiles}
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
            await setFiles([{ id: fileId, ...meta }]);
          }
          return (await setUri(resolvedUri)) ?? null;
        }
      : undefined;
  return [uri, setMetaUri];
};

export const usePickFileUri = () => useFileCache().pickFileUri;

export const useGetFileCache2Uri = () => useFileCache().getItem;
