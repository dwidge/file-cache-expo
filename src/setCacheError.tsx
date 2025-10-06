import { FileId } from "./types.js";

/**
 * State updater for cache errors.
 * Adds or removes/clears an error message for a specific file ID.
 *
 * @param id - The file ID.
 * @param error - The error message to set, or null to clear.
 * @returns A function that updates the previous state record.
 */
export const setCacheError =
  (id: FileId, error: string | null) => (prev: Record<string, string>) => {
    if (prev[id] == error) return prev;
    if (error) {
      return {
        ...prev,
        [id]: `${error}` || "Unknown error",
      };
    } else {
      const newErrors = { ...prev };
      delete newErrors[id];
      return newErrors;
    }
  };
