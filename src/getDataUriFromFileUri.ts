import { traceAsync } from "@dwidge/trace-js";
import { DataUri, FileUri } from "./types.js";
import { asDataUri, isDataUri, isFileUri } from "./uri.js";

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
    return new Promise<DataUri>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const v = reader.result?.toString() ?? null;
        if (v === null)
          reject(new Error("getDataUriFromFileUriE2", { cause: reader.error }));
        else resolve(asDataUri(v));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
);

export const getDataUriFromUri = async (uri: string): Promise<DataUri> => {
  if (isDataUri(uri)) return uri;
  if (isFileUri(uri)) return getDataUriFromFileUri(uri);
  throw new Error("getDataUriFromUriE1: Not a valid uri");
};
