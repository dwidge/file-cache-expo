import * as FileSystem from "expo-file-system";
import { useMemo } from "react";
import { Platform } from "react-native";
import { ExpoFileStorage } from "./ExpoFileStorage.js";
import { IndexedDBStorage } from "./IndexedDBStorage.js";
import { Disabled } from "./types.js";
import { UriStorage } from "./UriStorage.js";

/**
 * Hook to determine the appropriate local URI storage based on the platform.
 * @returns An object conforming to the UriStorage interface, or throw if no storage available.
 */
export const usePlatformLocalStorage = (
  scope: string | Disabled,
): UriStorage | Disabled =>
  useMemo(() => newPlatformLocalStorage(scope), [scope]);

export const newPlatformLocalStorage = (
  scope: string | Disabled,
): UriStorage | Disabled => {
  if (!scope) return;
  if (Platform.OS === "web") {
    if (typeof indexedDB !== "undefined") return new IndexedDBStorage(scope);
  } else {
    if (FileSystem.documentDirectory) return new ExpoFileStorage(scope);
  }

  throw new Error("usePlatformLocalStorageE1: None available");
};
