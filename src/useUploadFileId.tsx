import { AxiosInstance } from "axios";
import {
  getBufferFromUrlAndVerify,
  putBufferToUrlAndVerify,
} from "./getBufferFromUrl.js";
import { log } from "./log.js";
import { DataUri, Deleted, Disabled, FileId, GetFileUrls } from "./types.js";
import { getMetaBufferFromDataUri } from "./uri.js";

export type UploadFileId = (
  id: FileId,
  data: DataUri | Deleted,
) => Promise<void>;

/**
 * Hook to get a function that uploads a file to remote storage.
 *
 * @param getUrls - A function that returns signed URLs for a file.
 * @returns A function that uploads the file data.
 */
export const useUploadFileId = (
  getUrls?: GetFileUrls,
  axios?: AxiosInstance,
): UploadFileId | Disabled =>
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
        const [fileRecord] = await getUrls({ id });
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
