import { AxiosInstance } from "axios";
import {
  getBufferFromUrlAndVerify,
  putBufferToUrlAndVerify,
} from "./getBufferFromUrl.js";
import { log } from "./log.js";
import { DataUri, Deleted, Disabled, FileRecord } from "./types.js";
import { getMetaBufferFromDataUri } from "./uri.js";

export type UploadFileIdPayload = Partial<
  Pick<FileRecord, "getUrl" | "putUrl">
>;

export type UploadFileId = (
  payload: UploadFileIdPayload,
  data: DataUri | Deleted,
) => Promise<void>;

/**
 * Hook to get a function that uploads a file to remote storage.
 *
 * @returns A function that uploads the file data.
 */
export const useUploadFileId = (
  axios?: AxiosInstance,
): UploadFileId | Disabled =>
  axios
    ? async (
        payload: UploadFileIdPayload,
        data: DataUri | Deleted,
      ): Promise<void> => {
        log(`useUploadFileId1`, data?.length);
        if (data === null) {
          log(`File marked for deletion; not implemented, skipping upload.`);
          return;
        }
        const file = await getMetaBufferFromDataUri(data);
        if (!file)
          throw new Error(`useUploadFileIdE1: Unable to process data for file`);

        const { meta, buffer } = file;
        const { getUrl, putUrl } = payload;
        if (putUrl && getUrl) {
          log(`Uploading file`);
          await putBufferToUrlAndVerify({
            data: buffer,
            putUrl,
            getUrl,
            meta,
            axios,
          });
        } else if (getUrl) {
          log(`Confirming file`);
          await getBufferFromUrlAndVerify({ getUrl, meta, axios });
        } else {
          log(`Can't upload file`, payload);
          throw new Error(`useUploadFileIdE2: Missing upload URLs for file`, {
            cause: { urls: { getUrl, putUrl } },
          });
        }

        log(`File upload successful`);
      }
    : undefined;
