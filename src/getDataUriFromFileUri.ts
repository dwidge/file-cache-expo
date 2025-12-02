import { traceAsync } from "@dwidge/trace-js";
import { DataUri, FileUri } from "./types.js";
import { asDataUri, isBlobUri, isDataUri, isFileUri } from "./uri.js";

/**
 * Converts a Blob to a data URI.
 *
 * @param {Blob} blob - The blob to convert.
 * @returns {Promise<DataUri>} The data URI.
 */
export const getDataUriFromBlob = (blob: Blob): Promise<DataUri> =>
  new Promise<DataUri>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const v = reader.result?.toString() ?? null;
      if (v === null)
        reject(new Error("getDataUriFromBlobE1", { cause: reader.error }));
      else resolve(asDataUri(v));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

/**
 * Loads a file path and returns a data URI.
 *
 * @param {FileUri} filePath - The file path to load.
 * @returns {Promise<DataUri>} The data URI.
 * @throws {Error} If fetching or reading the file fails.
 */
export const getDataUriFromFileUri = traceAsync(
  "getDataUriFromFileUriE",
  async (filePath: FileUri): Promise<DataUri> => {
    const response = await fetch(filePath);
    if (!response.ok)
      throw new Error(
        `getDataUriFromFileUriE1: HTTP error! status: ${response.status}`,
      );

    const blob = await response.blob();
    return getDataUriFromBlob(blob);
  },
);

export const getDataUriFromUri = async (
  uri: string | Blob,
): Promise<DataUri> => {
  if (uri instanceof Blob) return getDataUriFromBlob(uri);
  if (isDataUri(uri)) return uri;
  if (isFileUri(uri) || isBlobUri(uri)) return getDataUriFromFileUri(uri);

  throw new Error("getDataUriFromUriE1: Not a valid uri or blob");
};
