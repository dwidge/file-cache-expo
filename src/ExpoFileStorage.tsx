import * as FileSystem from "expo-file-system";
import { DataUri, MIME } from "./types.js";
import {
  asDataUri,
  getBase64FromDataUri,
  getMimeTypeFromDataUri,
} from "./uri.js";
import { UriStorage, assertStorageAvailable } from "./UriStorage.js";

/**
 * @class ExpoFileStorage
 * @implements {UriStorage}
 *
 * Implements the UriStorage interface using Expo FileSystem API.
 * This storage mechanism persists data URIs as files within the Expo document directory.
 * Data is organized under a specified scope (a subdirectory) and further categorized by unique IDs, each getting its own subfolder.
 *
 * **Storage Structure:**
 *
 * ```
 * documentDirectory/
 * |--- [scope]/                     (e.g., 'myAppScope/' or empty if no scope)
 * |    |--- [id]/                     (Each ID becomes a subfolder)
 * |    |    |--- [mime-filename]    (e.g., 'image.jpeg', 'audio.mp3' based on MIME type)
 * ```
 *
 * **Handling Different URI States:**
 *
 * - **Valid Data URI:**  Stored as a file named after its MIME type within the ID's subfolder.
 * - **Null URI:** When a URI is explicitly set to `null` using `setUri(id, null)`, an empty subfolder for the ID is created. This indicates a purposefully null URI.
 * - **Undefined/Not Found URI:** If an ID's subfolder does not exist within the scope, it's considered not found, and `getUri(id)` will return `null`.
 *
 * **Key Features:**
 *
 * - **Scope Isolation:** Organizes data within a specified scope, preventing naming conflicts with other parts of your app or other apps.
 * - **Explicit Null Handling:** Differentiates between a URI that was explicitly set to `null` and a URI that was never set or has been deleted.
 * - **ID-based Retrieval:** Efficiently retrieves URIs using their unique IDs.
 * - **List IDs:** Provides a way to get all stored IDs, including those with null URIs.
 * - **Reset Functionality:** Clears the entire storage scope, removing all stored URIs.
 *
 * **Prerequisites:**
 *
 * - Requires the Expo FileSystem API to be available.
 * - Asserts the availability of `FileSystem.documentDirectory` during construction and in each method to ensure storage accessibility.
 *
 * @example
 * ```typescript
 * import { ExpoFileStorage } from './ExpoFileStorage';
 *
 * async function useFileStorage() {
 *   const storage = new ExpoFileStorage('myAppScope'); // Using 'myAppScope' as scope
 *
 *   // Set a URI
 *   const dataUri = 'data:image/png;base64,...';
 *   await storage.setUri('item1', dataUri);
 *
 *   // Get the URI
 *   const retrievedUri = await storage.getUri('item1'); // Returns dataUri
 *
 *   // Set a null URI
 *   await storage.setUri('item2', null);
 *   const nullUri = await storage.getUri('item2'); // Returns null
 *
 *   // Get all IDs
 *   const ids = await storage.getIds(); // Returns ['item1', 'item2']
 *
 *   // Reset storage
 *   await storage.reset();
 * }
 * ```
 */
export class ExpoFileStorage implements UriStorage {
  private basePath: string;
  private scope: string;

  /**
   * Constructs a new `ExpoFileStorage` instance.
   *
   * @param {string} scope - A scope or subdirectory within the document directory to store files.
   *        Using a scope helps organize files and avoid naming conflicts.
   *        If an empty string is provided, files are stored directly in the document directory.
   *        Example scopes: `'myAppScope'`, `'userAvatars'`, `''` (empty scope).
   *
   * @throws {Error} If Expo FileSystem documentDirectory is not available, indicating storage is not accessible.
   */
  constructor(scope: string) {
    assertStorageAvailable("ExpoFileStorage", !!FileSystem.documentDirectory);
    this.basePath = FileSystem.documentDirectory;
    this.scope = scope;
  }

  /**
   * Gets the full file path for a given ID and MIME type within the storage scope.
   *
   * @private
   * @param {string} id - The ID of the URI.
   * @param {MIME} mime - The MIME type to construct the filename (e.g., 'image/jpeg').
   * @returns {string} The full file path to the file.
   * @example `documentDirectory/myAppScope/itemId/image.jpeg`
   */
  private getFilePath(id: string, mime: MIME): string {
    const filename = mime.replace("/", "."); // Use MIME type as filename (e.g., image.jpeg)
    return `${this.getIdFolderPath(id)}${filename}`;
  }

  /**
   * Gets the folder path for a given ID within the storage scope.
   * Each ID gets its own subfolder to store the URI file (or to indicate a null URI).
   *
   * @private
   * @param {string} id - The ID of the URI.
   * @returns {string} The full folder path for the ID.
   * @example `documentDirectory/myAppScope/itemId/`
   */
  private getIdFolderPath(id: string): string {
    return `${this.getScopePath()}${id}/`;
  }

  /**
   * Gets the scope path within the document directory.
   * This is the base directory where all ID subfolders are created.
   *
   * @private
   * @returns {string} The scope path, including a trailing slash if a scope is defined.
   * @example `documentDirectory/myAppScope/` or `documentDirectory/` (if no scope)
   */
  private getScopePath(): string {
    return `${this.basePath}${this.scope ? `${this.scope}/` : ""}`;
  }

  /**
   * Retrieves a Data URI for a given ID from the storage.
   *
   * - If the URI was explicitly set to `null` using `setUri`, this method returns `null`.
   * - If the ID's subfolder does not exist or is empty, it also returns `null`, indicating the URI is not found or explicitly null.
   *
   * @async
   * @param {string} id - The ID of the URI to retrieve.
   * @returns {Promise<DataUri | null>} A promise that resolves to the Data URI string or `null` if not found or explicitly set to null.
   * @throws {Error} If an unexpected file system error occurs during retrieval (excluding directory not found errors, which are handled and return `null`).
   */
  getUri = async (id: string): Promise<DataUri | null> => {
    assertStorageAvailable("ExpoFileStorage", !!FileSystem.documentDirectory);
    const idFolderPath = this.getIdFolderPath(id);

    try {
      const folderInfo = await FileSystem.getInfoAsync(idFolderPath);
      if (!folderInfo.exists || !folderInfo.isDirectory) {
        return null; // Subfolder for ID does not exist (not found)
      }

      const folderContent = await readDirectorySafely(idFolderPath);
      if (folderContent.length === 0) return null; // Empty subfolder means null URI was set

      // Expecting only one file (MIME type file) per subfolder for valid URIs
      if (folderContent.length > 1) {
        console.warn(
          `getUriW1: Unexpected multiple files in ID folder: ${idFolderPath}. Using first file.`,
        );
      }

      const mimeFilename = folderContent[0]; // Get the MIME type filename
      const filePath = `${idFolderPath}${mimeFilename}`;
      const mime = mimeFilename.replace(".", "/"); // Reconstruct MIME type from filename
      return await readFileAsDataUri(filePath, mime as MIME);
    } catch (error: any) {
      throw new Error(`getUriE2: Error getting URI for ID '${id}'`, {
        cause: { error, id },
      });
    }
  };

  /**
   * Sets a Data URI for a given ID in the storage.
   *
   * - If `uri` is `null`, it creates an empty subfolder for the `id`.
   *   This signifies that a null URI is intentionally set for this ID.
   * - If `uri` is a valid Data URI, it stores the base64 encoded data as a file.
   *   The file is named after its MIME type and placed inside the ID's subfolder.
   *
   * @async
   * @param {string} id - The ID of the URI to set.
   * @param {DataUri | null} uri - The Data URI string to store, or `null` to set a null URI.
   * @returns {Promise<DataUri | null>} A promise that resolves to the Data URI that was set (or `null` if set to null).
   * @throws {Error} If an unexpected file system error occurs during storage.
   */
  setUri = async (id: string, uri: DataUri | null): Promise<DataUri | null> => {
    assertStorageAvailable("ExpoFileStorage", !!FileSystem.documentDirectory);
    const idFolderPath = this.getIdFolderPath(id);

    try {
      // Delete existing subfolder if any before writing new one
      await deletePathIdempotently(idFolderPath);
      // Ensure ID subfolder exists (or create it)
      await ensureDirectoryExists(idFolderPath);

      if (uri === null) {
        // For null URI, just ensure the folder exists and is empty (no file creation)
        return null;
      } else {
        const mime = getMimeTypeFromDataUri(uri);
        const filePath = this.getFilePath(id, mime);
        const base64String = getBase64FromDataUri(uri); // Extract base64 data

        await writeFileBase64(filePath, base64String);

        return asDataUri(uri); // Return the Data URI that was set
      }
    } catch (error: any) {
      throw new Error(`setUriE2: Error setting URI for ID '${id}': ${error}`, {
        cause: { error, id, uri },
      });
    }
  };

  /**
   * Deletes the subfolder associated with a given ID from the storage, effectively deleting the stored URI.
   *
   * @async
   * @param {string} id - The ID of the URI to delete.
   * @returns {Promise<null>} A promise that resolves to `null` after deletion.
   *         If the folder does not exist, it's considered a successful delete and resolves to `null`.
   * @throws {Error} If an unexpected file system error occurs during deletion.
   */
  deleteUri = async (id: string): Promise<null> => {
    assertStorageAvailable("ExpoFileStorage", !!FileSystem.documentDirectory);
    const idFolderPath = this.getIdFolderPath(id);
    try {
      await deletePathIdempotently(idFolderPath); // Delete ID subfolder recursively (idempotent: no error if it doesn't exist)
      return null; // Successful delete (or no-op if not found)
    } catch (error: any) {
      throw new Error(`deleteUriE1: Error deleting URI for ID '${id}'`, {
        cause: { error, id },
      });
    }
  };

  /**
   * Retrieves a list of all IDs currently stored in the storage.
   * This includes IDs for both valid Data URIs and null URIs (those explicitly set to `null`).
   * It lists the names of the subfolders directly under the scope path.
   *
   * @async
   * @returns {Promise<string[]>} A promise that resolves to an array of IDs (subfolder names).
   *         Returns an empty array if the scope directory does not exist.
   * @throws {Error} If an unexpected file system error occurs during directory reading (excluding directory not found errors, which result in an empty array).
   */
  getIds = async (): Promise<string[]> => {
    assertStorageAvailable("ExpoFileStorage", !!FileSystem.documentDirectory);
    const scopePath = this.getScopePath();
    try {
      await ensureDirectoryExists(scopePath);
      const directoryContent = await readDirectorySafely(scopePath);
      return directoryContent; // Subfolder names are the IDs
    } catch (error: any) {
      throw new Error(`getIdsE1: Error getting IDs`, {
        cause: { error, scopePath },
      });
    }
  };

  /**
   * Resets the storage by deleting the entire scope directory and all its contents.
   * After reset, the storage will be completely empty for the given scope.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when the reset is complete.
   * @throws {Error} If an unexpected file system error occurs during directory deletion (excluding directory not found errors, which are ignored).
   */
  reset = async (): Promise<void> => {
    assertStorageAvailable("ExpoFileStorage", !!FileSystem.documentDirectory);
    const scopePath = this.getScopePath();
    try {
      await deletePathIdempotently(scopePath); // Delete scope directory and all contents recursively (idempotent: no error if it doesn't exist)
    } catch (error: any) {
      throw new Error(`resetE1: Error resetting storage`, {
        cause: { error, scopePath },
      });
    }
  };
}

/**
 * Helper function to ensure a directory exists. Creates it with intermediate directories if necessary.
 * @param directoryPath
 * @returns {Promise<void>}
 * @throws {Error} if directory creation fails unexpectedly
 */
const ensureDirectoryExists = async (directoryPath: string): Promise<void> => {
  try {
    await FileSystem.makeDirectoryAsync(directoryPath, { intermediates: true });
  } catch (error: any) {
    throw new Error(
      `ensureDirectoryExistsE1: Error ensuring directory exists at '${directoryPath}'`,
      { cause: { error, directoryPath } },
    );
  }
};

/**
 * Helper function to read the content of a directory.
 * Returns an empty array if the directory does not exist, treating it as no content.
 * @param directoryPath
 * @returns {Promise<string[]>} - Array of filenames in the directory.
 * @throws {Error} if directory reading fails unexpectedly (excluding directory not found errors).
 */
const readDirectorySafely = async (
  directoryPath: string,
): Promise<string[]> => {
  try {
    return await FileSystem.readDirectoryAsync(directoryPath);
  } catch (error: any) {
    if (
      error.code === "ERR_FILE_SYSTEM_CANNOT_READ_DIRECTORY" ||
      error.message.includes("ENOENT") ||
      error.message.includes("No such directory")
    ) {
      return []; // Directory not found is treated as empty content
    }
    throw new Error(
      `readDirectorySafelyE1: Error reading directory at '${directoryPath}'`,
      { cause: { error, directoryPath } },
    );
  }
};

/**
 * Helper function to delete a file or directory idempotently (no error if not found).
 * @param path - Path to the file or directory to delete.
 * @returns {Promise<void>}
 * @throws {Error} if deletion fails unexpectedly
 */
const deletePathIdempotently = async (path: string): Promise<void> => {
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch (error: any) {
    throw new Error(`deletePathIdempotentlyE1: Error deleting path '${path}'`, {
      cause: { error, path },
    });
  }
};

/**
 * Helper function to write a string to a file in base64 encoding.
 * @param filePath
 * @param base64String
 * @returns {Promise<void>}
 * @throws {Error} if writing to file fails.
 */
const writeFileBase64 = async (
  filePath: string,
  base64String: string,
): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(filePath, base64String, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error: any) {
    throw new Error(
      `writeFileBase64E1: Error writing base64 string to file '${filePath}'`,
      { cause: { error, filePath } },
    );
  }
};

/**
 * Helper function to read a file and return its content as a Data URI.
 * This is used to convert a stored file (containing base64 data) back into a Data URI string.
 *
 * @param {string} filePath The full path to the file to read.
 * @param {MIME} mime The MIME type of the file (e.g., 'image/jpeg').
 * @returns {Promise<DataUri>} A promise resolving to the Data URI string representing the file content.
 * @throws {Error} If a file system error occurs during reading.
 */
const readFileAsDataUri = async (
  filePath: string,
  mime: MIME,
): Promise<DataUri> => {
  try {
    const base64String = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return asDataUri(`data:${mime};base64,${base64String}`); // Construct Data URI
  } catch (error: any) {
    throw new Error(
      `readFileAsDataUriE1: Error reading file as Data URI from path '${filePath}'`,
      { cause: { error, filePath, mime } },
    );
  }
};
