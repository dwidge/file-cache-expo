// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import assert from "assert";
import { AxiosInstance } from "axios";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  getBufferFromUrlAndVerify,
  putBufferToUrlAndVerify,
} from "./getBufferFromUrl";
import { getDataUriFromFileUri } from "./getDataUriFromFileUri";
import { DataUri, Disabled, UseFileRecord } from "./types";
import {
  getBufferBinFromDataUri,
  getDataUriFromBufferBin,
  getDocFromDataUri,
  getMimeTypeFromDataUri,
  getSizeFromDataUri,
  isDataUri,
  isFileUri,
} from "./uri";
import { UriStorage } from "./UriStorage";
import { useManagedUriItem } from "./useLocalUri";

export const defaultUriStorageContext = createContext<UriStorage | Disabled>(
  undefined,
);

/**
 * A hook for managing file URIs, handling local processing, uploading, and fetching,
 * with synchronization based on file metadata, including an 'updatedAt' timestamp.
 *
 * @param {[UseFile2, (meta: UseFile2) => void]} remoteMetaTuple - A tuple containing the remote file metadata object and its setter from the UseFile2 hook.
 * @param {ReturnType<useAxios>} [axios=useAxios()] - An optional axios instance or the result of useAxios().
 * @returns {[string | null | undefined, ((uri: string | null, mime?: string) => Promise<void>) | undefined, boolean | undefined, boolean | undefined]}
 * An array containing:
 *   - The local file URI (or null if not present, or undefined if loading).
 *   - A function to set the local URI and initiate processing/upload.
 *   - A boolean indicating if an upload is currently in progress.
 *   - A boolean indicating if a download is currently in progress.
 */
export const useFileUri1 = (
  [remoteMeta, setRemoteMeta]: UseFileRecord,
  axios: AxiosInstance | Disabled,
  context: UriStorage | Disabled = useContext(defaultUriStorageContext),
): [
  string | null | undefined,
  ((uri: string | null, mime: string) => Promise<void>) | undefined,
  boolean | undefined,
  boolean | undefined,
] => {
  const [localUri, setLocalUri] =
    useManagedUriItem(remoteMeta ? remoteMeta.id : undefined, context) ?? [];
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  /**
   * Resets the local file state, clearing the URI, upload status, and relevant file metadata.
   */
  const resetFileState = useMemo(
    () =>
      remoteMeta && setRemoteMeta && setLocalUri
        ? async () => {
            setLocalUri(null);
            setIsUploading(false);
            await setRemoteMeta({
              ...remoteMeta,
              mime: null,
              sha256: null,
              size: null,
            });
          }
        : undefined,
    [remoteMeta, setRemoteMeta],
  );

  /**
   * Processes the local file URI, potentially compressing images, converting to data URI,
   * and updating the local file metadata.
   *
   * @param {string} uri - The file URI to process.
   * @param {string} mime - The MIME type of the file.
   * @returns {Promise<string>} The processed data URI.
   * @throws {Error} If compression or processing fails.
   */
  const processAndSetLocalUri = useMemo(
    () =>
      remoteMeta && setRemoteMeta && setLocalUri
        ? async (uri: string, mime: string) => {
            try {
              console.log(
                "useFileUri: Processing and setting local URI for file:",
                remoteMeta.id,
              );

              const dataUri: DataUri | null = isDataUri(uri)
                ? uri
                : isFileUri(uri)
                  ? await getDataUriFromFileUri(uri)
                  : null;
              setLocalUri(dataUri);
              return dataUri; // Indicate success
            } catch (error) {
              console.warn("useFileUri: Error processing URI:", error);
              setLocalUri(null);
              throw error;
            }
          }
        : undefined,
    [remoteMeta, setRemoteMeta],
  );

  /**
   * Uploads the local file to the server.
   *
   * @returns {Promise<void>}
   * @throws {Error} If upload parameters are missing or the upload fails.
   */
  const uploadFile = useMemo(
    () =>
      localUri && remoteMeta && setRemoteMeta
        ? async () => {
            const { putUrl, getUrl } = remoteMeta;

            if (!putUrl || !getUrl) {
              console.warn(
                "useFileUri: Missing upload putUrl/getUrl in file object:",
                remoteMeta,
              );
              return;
            }

            setIsUploading(true);
            console.log("useFileUri: Starting upload for file:", remoteMeta.id);
            try {
              const mime = await getMimeTypeFromDataUri(localUri);
              const size = await getSizeFromDataUri(localUri);
              const doc = await getDocFromDataUri(localUri);
              const sha256 = doc.sha256;

              if (!mime || size === undefined || !sha256) {
                console.warn(
                  "useFileUri: Missing upload parameters from local URI.",
                );
                return;
              }

              const localBuffer = getBufferBinFromDataUri(localUri);
              await putBufferToUrlAndVerify({
                data: localBuffer,
                putUrl,
                getUrl,
                meta: { size, mime, sha256 },
                axios,
              });
              await setRemoteMeta({
                ...remoteMeta,
                mime,
                size,
                sha256,
                updatedAt: (Date.now() / 1000) | 0,
              });
              console.log(
                "useFileUri: Upload successful for file:",
                remoteMeta.id,
              );
            } catch (error) {
              console.warn(
                "useFileUri: Upload failed for file:",
                remoteMeta?.id,
                error,
              );
              throw error;
            } finally {
              setIsUploading(false);
            }
          }
        : undefined,
    [axios, localUri, remoteMeta, setRemoteMeta],
  );

  /**
   * Fetches the file URI and metadata from the server.
   *
   * @returns {Promise<void>}
   * @throws {Error} If fetching fails.
   */
  const fetchFile = useMemo(
    () =>
      remoteMeta?.getUrl && setLocalUri && setRemoteMeta
        ? async () => {
            const { getUrl, id, size, mime, sha256 } = remoteMeta;

            if (getUrl) {
              assert(size);
              assert(mime);
              assert(sha256);
              setIsDownloading(true);
              console.log("useFileUri: Fetching file from server for:", id);
              try {
                const bufferBin = await getBufferFromUrlAndVerify({
                  getUrl,
                  meta: { size, mime, sha256 },
                  axios,
                });
                const remoteUri = bufferBin
                  ? getDataUriFromBufferBin(bufferBin)
                  : null;
                console.log(
                  "useFileUri: Fetched URI from server:",
                  remoteUri,
                  "for file:",
                  id,
                );
                setLocalUri(remoteUri);
              } catch (error) {
                console.warn(
                  "useFileUri: Error fetching file URI from server:",
                  error,
                );
                throw error;
              } finally {
                setIsDownloading(false);
              }
            } else {
              console.warn(
                "useFileUri: Cannot fetch URI. Missing getUrl in remoteMeta object:",
                remoteMeta,
              );
            }
          }
        : undefined,
    [axios, remoteMeta, setLocalUri, setRemoteMeta],
  );

  /**
   * Compares local and remote file metadata.
   *
   * @returns {Promise<boolean>} True if local and remote metadata are the same, false otherwise.
   */
  const areMetaSame = useMemo(
    () => async () => {
      if (!localUri || !remoteMeta) return false;
      try {
        const localMime = await getMimeTypeFromDataUri(localUri);
        const localSize = await getSizeFromDataUri(localUri);
        const localDoc = await getDocFromDataUri(localUri);
        const localSha256 = localDoc.sha256;

        return (
          localMime === remoteMeta.mime &&
          localSize === remoteMeta.size &&
          localSha256 === remoteMeta.sha256
        );
      } catch (error) {
        console.warn("useFileUri: Error getting local file metadata:", error);
        return false;
      }
    },
    [localUri, remoteMeta],
  );

  /**
   * Sets the local URI and initiates processing, handling null URIs to reset the state.
   *
   * @param {string | null} uri - The URI to set, or null to reset.
   * @param {string} [mime] - The MIME type of the file, required when setting a non-null URI.
   * @returns {Promise<void>}
   */
  const setUri = useMemo(
    () =>
      resetFileState && processAndSetLocalUri
        ? async (uri: string | null, mime: string) => {
            if (uri == null) {
              await resetFileState();
            } else {
              if (mime) {
                await processAndSetLocalUri(uri, mime);
              } else {
                console.warn(
                  "useFileUri: MIME type is required when setting a URI.",
                );
              }
            }
          }
        : undefined,
    [processAndSetLocalUri, resetFileState],
  );

  // Effect to handle uploading when localUri is available and differs from remoteMeta
  useEffect(() => {
    if (isUploading || isDownloading) return; // busy transferring binary
    if (localUri === undefined) return; // busy loading local
    if (remoteMeta === undefined) return; // busy loading remote
    if (remoteMeta === null) return; // remote has not been created

    const syncFile = async () => {
      if (localUri && remoteMeta) {
        if (
          remoteMeta.mime &&
          remoteMeta.size !== undefined &&
          remoteMeta.sha256 &&
          remoteMeta.updatedAt !== undefined
        ) {
          const metaAreSame = await areMetaSame();
          if (!metaAreSame) {
            console.log(
              "useFileUri: Local and remote metadata differ, fetching from server for:",
              remoteMeta.id,
            );
            try {
              fetchFile?.();
            } catch (error) {
              console.warn("useFileUri: Error fetching metadata:", error);
            }
          } else {
            console.log(
              "useFileUri: Local and remote metadata are the same for:",
              remoteMeta.id,
            );
          }
        } else if (localUri) {
          // Remote meta might be missing some data, initiate upload to sync
          console.log(
            "useFileUri: Remote metadata possibly incomplete, initiating upload for:",
            remoteMeta.id,
          );
          uploadFile?.();
        }
      } else if (remoteMeta?.getUrl) {
        console.log("useFileUri: Fetching remote metadata for:", remoteMeta.id);
        fetchFile?.();
      }
    };

    syncFile();
  }, [
    localUri,
    remoteMeta,
    isUploading,
    isDownloading,
    uploadFile,
    areMetaSame,
    fetchFile,
  ]);

  console.log(
    "useFileUri: Status - Uploading:",
    isUploading,
    "Downloading:",
    isDownloading,
    "Local URI:",
    localUri,
    "Remote Meta:",
    remoteMeta,
  );

  return [
    remoteMeta?.getUrl === null ? null : localUri,
    setUri,
    isUploading,
    isDownloading,
  ];
};
