import { AxiosInstance } from "axios";
import { getBufferFromUrlAndVerify } from "./getBufferFromUrl.js";
import { DataUri, Disabled, FileId, FileMeta, GetFileUrls } from "./types.js";
import { getDataUriFromBufferBin } from "./uri.js";

export type DownloadFileId = (
  id: FileId,
) => Promise<DataUri | null | undefined>;

/**
 * Hook to get a function that downloads a file from remote storage.
 *
 * @param getUrls - A function that returns signed URLs for a file.
 * @returns A function that downloads and returns the file’s DataUri.
 */
export const useDownloadFileId = (
  getUrls?: GetFileUrls,
  axios?: AxiosInstance,
): DownloadFileId | Disabled =>
  getUrls
    ? async (id: FileId): Promise<DataUri | null | undefined> => {
        const [record] = await getUrls({ id });
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
