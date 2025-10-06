import { FileId } from "./types.js";

/**
 * State updater for missing file IDs.
 * Adds or removes an ID from the list of missing file IDs.
 *
 * @param id - The file ID.
 * @param enable - Whether to add (true) or remove (false) the ID. Defaults to false.
 * @returns A function that updates the previous state array.
 */
export const setMissingId =
  (id: FileId, enable = false) =>
  (prev: string[]) => {
    if (enable == prev.includes(id)) return prev;
    if (enable) return [...new Set([...prev, id])];
    else return prev.filter((p) => p !== id);
  };
