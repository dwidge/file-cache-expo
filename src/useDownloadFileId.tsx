import { AxiosInstance } from "axios";
import { getBufferFromUrlAndVerify } from "./getBufferFromUrl.js";
import { DataUri, Disabled, FileMeta, FileRecord } from "./types.js";
import { getDataUriFromBufferBin } from "./uri.js";

export type DownloadFilePayload = Partial<
  Pick<FileRecord, "getUrl" | "size" | "mime" | "sha256">
>;

export type DownloadFileId = (
  payload: DownloadFilePayload,
) => Promise<DataUri | null | undefined>;

/**
 * Hook to get a function that downloads a file from remote storage.
 *
 * @returns A function that downloads and returns the file’s DataUri.
 */
export const useDownloadFileId = (
  axios?: AxiosInstance,
): DownloadFileId | Disabled =>
  axios
    ? async (
        record: DownloadFilePayload,
      ): Promise<DataUri | null | undefined> => {
        if (!record)
          throw new Error(`useDownloadFileIdE2: No record/meta found for file`);

        if (
          record.size === null &&
          record.mime === null &&
          record.sha256 === null
        )
          return null;

        if (record.size == null || record.mime == null || record.sha256 == null)
          throw new Error(
            `useDownloadFileIdE1: Incomplete file meta for file`,
            { cause: { fileMeta: record } },
          );

        if (!record.getUrl)
          throw new Error(
            `useDownloadFileIdE3: No download URL available for file`,
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
