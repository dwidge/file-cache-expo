import pLimit from "p-limit";
import { log } from "./log.js";
import { setCacheError } from "./setCacheError.js";
import { FileId } from "./types.js";
import { getSizeFromDataUri } from "./uri.js";
import { DownloadFileId } from "./useDownloadFileId.js";
import { ManagedUriStorage } from "./useLocalUri.js";
import { UploadFileId } from "./useUploadFileId.js";

/**
 * Synchronize pending files by uploading each one.
 *
 * For each file ID in the pending list, the corresponding DataUri is loaded
 * from upload storage and then uploaded remotely. Upon successful upload,
 * the file data is moved from upload storage to cache storage.
 */
export const syncPendingFiles = async ({
  uploadFileIds,
  getUploadUri,
  uploadFile,
  downloadFile,
  setCacheUri,
  deleteUploadUri,
  setUploadErrors,
  signal,
  concurrency = 1,
}: {
  uploadFileIds: FileId[];
  getUploadUri: NonNullable<ManagedUriStorage["getUri"]>;
  uploadFile: UploadFileId;
  downloadFile: DownloadFileId;
  setCacheUri: NonNullable<ManagedUriStorage["setUri"]>;
  deleteUploadUri: NonNullable<ManagedUriStorage["deleteUri"]>;
  setUploadErrors: React.Dispatch<React.SetStateAction<Record<FileId, string>>>;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<void> => {
  log("Start upload pending list...", { count: uploadFileIds.length });

  setUploadErrors({});

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
      } catch (error: unknown) {
        if (signal?.aborted) throw error;

        log(`syncPendingFilesE1: Error upload pending file ${id}: ${error}`, {
          cause: error,
        });
        setUploadErrors(setCacheError(id, `${error}`));
        const dataUri = await getUploadUri(id);
        if (dataUri === undefined)
          log(
            `syncPendingFilesE21: DataUri not found in uploadStorage for file ${id} after upload failure.`,
          );
        else if (dataUri === null)
          log(
            `syncPendingFilesE22: DataUri found in uploadStorage for file ${id} (null) after upload failure.`,
          );
        else
          log(
            `syncPendingFilesE23: DataUri found in uploadStorage for file ${id} (length ${getSizeFromDataUri(dataUri)}) after upload failure.`,
          );

        throw error;
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
};
