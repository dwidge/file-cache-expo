import { useLocal } from "@dwidge/crud-api-react";
import { AsyncState, useJson } from "@dwidge/hooks-react";
import { FileId } from "./types.js";
import { useStringArray } from "./useStringArray.js";

/**
 * Hook to retrieve the list of pending file IDs.
 * We assume that pending IDs are stored as JSON in local storage.
 */
const usePendingIds = (): AsyncState<FileId[]> => {
  const ids = useStringArray(
    useJson(useLocal<string | null>("pendingFileIds", null)),
  );
  return ids;
};

/**
 * Hook to retrieve the list of recent file IDs.
 */
const useRecentIds = (): AsyncState<FileId[]> => {
  const ids = useStringArray(
    useJson(useLocal<string | null>("recentFileIds", null)),
  );
  return ids;
};
