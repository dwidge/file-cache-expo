import { useCallback, useEffect, useRef, useState } from "react";

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
      const currentCount = refCount.current.get(id) || 0;
      refCount.current.set(id, currentCount + 1);

      if (currentCount === 0) {
        setMounted((prev) => {
          if (!prev.includes(id)) return [...prev, id].slice(0, maxMounted);
          return prev;
        });
      }

      setRecent((prev) => {
        const filtered = prev.filter((x) => x !== id);
        const newQueue = [id, ...filtered];
        return newQueue.slice(0, maxRecent);
      });

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
    const unregister = register(fileId);
    return unregister;
  }, [fileId, register]);
}
