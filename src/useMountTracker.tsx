import { useCallback, useEffect, useRef, useState } from "react";

//
// Types for FileId and our hook return value
//
export type FileId = string;

export interface MountTracker {
  mounted: FileId[];
  recent: FileId[];
  /**
   * Registers a file ID as “mounted.”
   * Returns an unregister function to be called on unmount.
   */
  register: (id: FileId) => () => void;
  /**
   * Resets the mount tracker, clearing the mounted and recent lists, and the internal reference counts.
   */
  reset: () => void;
}

//
// The hook that holds the two lists and provides the registration function.
// It uses a ref to hold reference counts so that if the same file ID is mounted multiple times,
// we only add it once to the mounted list, and only remove it when the last instance unmounts.
// It also maintains the recent list as a “queue” (most recent first, sliced to maxRecent).
//
/**
 * A React hook for tracking mounted file IDs, managing a list of currently mounted files and recently mounted files.
 * It uses reference counting to handle multiple mounts of the same file ID and maintains a 'recent' list as a queue.
 *
 * @param {object} options - Configuration options for the mount tracker.
 * @param {number} options.maxMounted - The maximum number of file IDs to keep in the `mounted` list. Older entries are removed when the list exceeds this limit.
 * @param {number} options.maxRecent - The maximum number of file IDs to keep in the `recent` list. Older entries are removed when the list exceeds this limit.
 * @returns {MountTracker} An object containing the `mounted` and `recent` file ID lists, a `register` function to track mounts, and a `reset` function to clear the tracker.
 */
export function useMountTracker({
  maxMounted,
  maxRecent,
}: {
  maxMounted: number;
  maxRecent: number;
}): MountTracker {
  const [mounted, setMounted] = useState<FileId[]>([]);
  const [recent, setRecent] = useState<FileId[]>([]);
  const refCount = useRef<Map<FileId, number>>(new Map());

  const register = useCallback(
    (id: FileId) => {
      // Increase the reference count.
      const currentCount = refCount.current.get(id) || 0;
      refCount.current.set(id, currentCount + 1);

      // If this is the first mount, add it to the mounted list.
      if (currentCount === 0) {
        setMounted((prev) => {
          // Avoid duplicates; maxMounted could be used to limit, if desired.
          if (!prev.includes(id)) return [...prev, id].slice(0, maxMounted);
          return prev;
        });
      }

      // Update the recent list: always bring this id to the front.
      setRecent((prev) => {
        const filtered = prev.filter((x) => x !== id);
        const newQueue = [id, ...filtered];
        return newQueue.slice(0, maxRecent);
      });

      // Return an unregister function to be called on unmount.
      return () => {
        const current = refCount.current.get(id) || 0;
        if (current <= 1) {
          refCount.current.delete(id);
          setMounted((prev) => prev.filter((x) => x !== id));
        } else {
          refCount.current.set(id, current - 1);
        }
      };
    },
    [maxMounted, maxRecent],
  );

  /**
   * Resets the mount tracker by clearing the mounted and recent lists, and the internal reference counts.
   * This function is part of the MountTracker return value.
   */
  const reset = useCallback(() => {
    setMounted([]);
    setRecent([]);
    refCount.current = new Map();
  }, []);

  return { mounted, recent, register, reset };
}

//
// A small helper hook that components (or useItem) can call to “register” their fileId.
// It uses an effect so that registration happens only when the fileId changes, and automatically
// unregisters on unmount, thus preventing render loops.
//
/**
 * A helper React hook for registering a file ID with a MountTracker.
 * It uses an effect to register the file ID when it changes and automatically unregisters on unmount.
 *
 * @param {object} params - Parameters for the hook.
 * @param {MountTracker} params.register - The `register` function from the `useMountTracker` hook.
 * @param {FileId | undefined} params.fileId - The file ID to register. If undefined, the hook does nothing.
 */
export function useMountTrackerItem(
  { register }: MountTracker,
  fileId?: FileId,
) {
  useEffect(() => {
    if (!fileId) return;
    // Register the fileId on mount.
    const unregister = register(fileId);
    // Automatically unregister on unmount.
    return unregister;
  }, [fileId, register]);
}
