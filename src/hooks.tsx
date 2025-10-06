/**
 * @module fileCache/hooks
 *
 * This module provides hooks for working with file data URIs locally and remotely.
 */

import { AsyncDispatch, AsyncState } from "@dwidge/hooks-react";
import { AxiosInstance } from "axios";
import { useEffect, useMemo } from "react";
import {
  getBufferFromUrlAndVerify,
  putBufferToUrlAndVerify,
} from "./getBufferFromUrl.js";
import { DataUri, Disabled, FileRecord, GetFileUrls } from "./types";
import {
  getBufferBinFromDataUri,
  getDataUriFromBufferBin,
  getMetaFromBuffer,
} from "./uri.js";
import { UriStorage } from "./UriStorage.js";
import { useManagedUriItem } from "./useLocalUri.js";

/**
 * Hook for managing local file data URI state.
 *
 * @param state - Tuple containing the file meta state and its setter.
 * @param cacheState - Tuple containing the local data URI cache state and its setter.
 * @returns An async state tuple for the data URI.
 */
export const useLocalDataUri = (
  [file, setFile]: AsyncState<FileRecord | null, Partial<FileRecord> | null>,
  [cache, setCache]: AsyncState<DataUri | null>,
): AsyncState<DataUri | null> => {
  const updateLocalDataUri: AsyncDispatch<DataUri | null> | undefined =
    useMemo(() => {
      if (!file || !setFile || !setCache) return undefined;

      return async (getUri) => {
        const uri = await (typeof getUri === "function"
          ? getUri(null)
          : getUri);
        const { id } = file;

        if (uri === null) {
          const meta = { size: null, mime: null, sha256: null };
          await setFile({ id, ...meta });
          await setCache(uri);
          return uri;
        } else {
          const localBuffer = getBufferBinFromDataUri(uri);
          const meta = await getMetaFromBuffer(localBuffer);
          await setFile({ id, ...meta });
          await setCache(uri);
          return uri;
        }
      };
    }, [file, setFile, setCache]);

  console.log("useLocalDataUri1", {
    cache,
    canUpdate: !!updateLocalDataUri,
    file,
  });
  return [cache, updateLocalDataUri];
};

/**
 * Hook for managing remote file data URI state (including upload & download).
 *
 * @param state - Tuple containing the file meta state and its setter.
 * @param cacheState - Tuple containing the cached data URI state and its setter.
 * @param axiosInstance - Axios instance for HTTP requests.
 * @param getFileUrls - Function to fetch file signed urls remotely.
 * @returns An async state tuple for the remote data URI.
 */
export const useRemoteDataUri = (
  [file, setFile]: AsyncState<FileRecord | null, Partial<FileRecord> | null>,
  [cache, setCache]: AsyncState<DataUri | null | undefined>,
  axiosInstance: AxiosInstance,
  getFileUrls?: GetFileUrls,
): AsyncState<DataUri | null> => {
  const fetchRemoteDataUri = useMemo(() => {
    if (!file || !setCache) return undefined;
    return async (): Promise<DataUri | null> => {
      const { getUrl, size, mime, sha256 } = file;
      if (!getUrl) {
        console.warn(
          "useRemoteDataUriE1: Missing getUrl in file object:",
          file,
        );
        return null;
      }
      if (!(size && mime && sha256)) {
        console.warn("useRemoteDataUriE2: Incomplete file meta:", file);
        return null;
      }
      const bufferBin = await getBufferFromUrlAndVerify({
        getUrl,
        meta: { size, mime, sha256 },
        axios: axiosInstance,
      });
      const remoteUri = bufferBin ? getDataUriFromBufferBin(bufferBin) : null;
      setCache(remoteUri);
      return remoteUri;
    };
  }, [file, setCache, axiosInstance]);

  const updateRemoteDataUri: AsyncDispatch<DataUri | null> | undefined =
    useMemo(() => {
      if (!file || !getFileUrls || !setFile || !setCache) return undefined;
      return async (getUri) => {
        const uri = await (typeof getUri === "function"
          ? getUri(null)
          : getUri);
        const { id } = file;

        if (uri === null) {
          const meta = { size: null, mime: null, sha256: null };
          await setFile({ id, ...meta });
          await setCache(uri);
          return uri;
        } else {
          const localBuffer = getBufferBinFromDataUri(uri);
          const meta = await getMetaFromBuffer(localBuffer);
          await setFile({ id, ...meta });
          await setCache(uri);

          const [urls] = await getFileUrls({ id });
          if (!urls)
            throw new Error("updateRemoteDataUriE1: Failed to get file urls");

          const { putUrl, getUrl } = urls;
          if (!putUrl || !getUrl)
            throw new Error("updateRemoteDataUriE2: Missing putUrl/getUrl");

          console.log("updateRemoteDataUri1: Uploading file", id);
          await putBufferToUrlAndVerify({
            data: localBuffer,
            putUrl,
            getUrl,
            meta,
            axios: axiosInstance,
          });
          console.log("updateRemoteDataUri2: Upload successful for file", id);
          return uri;
        }
      };
    }, [file, setFile, setCache, getFileUrls, axiosInstance]);

  useEffect(() => {
    if (cache === null && file && setCache && fetchRemoteDataUri) {
      setCache(fetchRemoteDataUri);
    }
  }, [cache, file, setCache, fetchRemoteDataUri]);

  console.log("useRemoteDataUri1", {
    cache,
    canUpdate: !!updateRemoteDataUri,
    file,
  });
  return [cache, updateRemoteDataUri];
};

/**
 * Hook for accessing a file’s data URI from the cache.
 *
 * @param fileId - The file identifier.
 * @param localStorageScope - The local storage scope (e.g. "cache" or "pending").
 * @param getFileUrls - Function to fetch file signed urls from the remote API.
 * @returns An async state tuple of the file’s data URI.
 */
export const useCacheFileUri = (
  fileId: string | Disabled,
  context: UriStorage,
  [file, setFile]: AsyncState<FileRecord | null, Partial<FileRecord> | null>,
  axios: AxiosInstance,
  getFileUrls?: GetFileUrls,
): AsyncState<DataUri | null | undefined> => {
  const [localCache, setLocalCache] = useManagedUriItem(fileId, context) ?? [];

  useRemoteDataUri(
    [file, setFile],
    [localCache, setLocalCache],
    axios,
    getFileUrls,
  );

  console.log("useCacheFileUri1:", fileId, { canSetCache: !!setLocalCache });
  return [localCache, setLocalCache];
};
