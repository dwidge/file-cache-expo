import {
  AsyncDispatch,
  AsyncState,
  getActionValue,
  useAsyncState,
  useRecordItem,
  useRecordKeys,
} from "@dwidge/hooks-react";
import { useEffect, useMemo, useState } from "react";
import { DataUri, Disabled } from "./types.js";
import { UriStorage } from "./UriStorage.js";

/**
 * A thin interface that wraps the raw storage with a synced list of IDs and update signals.
 */
export interface ManagedUriStorage {
  /** Internal record used to observe ID changes and trigger updates. */
  items?: Record<string, {}>;
  /** The list of IDs that have data stored. */
  ids?: string[];
  /** Retrieves the DataUri for the given id. */
  getUri?: (id: string) => Promise<DataUri | null>;
  /**
   * Sets the DataUri for the given id.
   * Passing null will delete the URI and remove the id.
   */
  setUri?: (id: string, data: DataUri | null) => Promise<DataUri | null>;
  /**
   * Resets the storage, deleting all URIs and clearing the ID list.
   */
  reset?: () => Promise<void>;
}

/**
 * Wraps a raw URI storage to maintain an internal list of IDs and update signals.
 * The list of IDs is needed to for watching state updates. UriStorage does not watch changes to its files.
 *
 * @param context - A storage object implementing UriStorage or a disabled value.
 * @returns A SyncedUriStorage interface or Disabled.
 */
export const useManagedUriStorage = (
  context: UriStorage | Disabled,
): ManagedUriStorage | Disabled => {
  const { getIds, getUri, setUri, deleteUri, reset } = context ?? {};

  // Maintain a record of observed files to trigger updates in hooks.
  const [items, setItems] = useState<Record<string, {}> | undefined>(undefined);

  // If the storage has a getIds() method, fetch the current IDs once.
  useEffect(() => {
    let isMounted = true;
    setItems(undefined);
    if (getIds) {
      getIds().then((fetchedIds: string[]) => {
        if (isMounted)
          setItems(Object.fromEntries(fetchedIds.map((id) => [id, {}])));
      });
    }
    return () => {
      isMounted = false;
    };
  }, [getIds]);

  // Updates the items state as needed.
  const mySetUri = useMemo(
    () =>
      setUri
        ? async (id: string, data: DataUri | null) => {
            // console.log("mySetUri1", id, data?.length ?? null);
            await setUri(id, data);
            setItems((prev) => ({ ...prev, [id]: {} }));
            return data;
          }
        : undefined,
    [setUri, setItems],
  );

  // Calls the storage reset and clears local items.
  const myReset = useMemo(
    () =>
      reset
        ? async () => {
            await reset();
            setItems({}); // Clear all ids and signals on reset
          }
        : undefined,
    [reset],
  );

  const ids = useRecordKeys([items]);

  return useMemo(
    () => ({
      ids,
      items,
      getUri,
      setUri: mySetUri,
      reset: myReset,
    }),
    [ids, items, mySetUri, myReset],
  );
};

/**
 * Hook to manage a locally stored Data URI.
 *
 * When either `id` or `context` is `Disabled` (or effectively `undefined`), the hook returns `Disabled`, indicating the feature is disabled.
 * Otherwise, when `id` is a valid string, it returns an AsyncState array:
 *   - The first element is the current Data URI, which can be:
 *     - `undefined`: when the URI is busy being loaded.
 *     - `null`: if no Data URI is stored for the given `id`.
 *     - `DataUri (string)`: the stored Data URI.
 *   - The second element is an asynchronous dispatch function to set the Data URI.
 *     - Setting the Data URI will persist it in the storage provided by `context`.
 *     - Setting the Data URI to `null` will delete the persisted URI from storage.
 *
 * @param id - The identifier for the Data URI, or `Disabled`. If `Disabled`, the hook returns `Disabled`.
 * @param context - A `ManagedUriStorage` interface providing storage operations, or `Disabled`. If `Disabled`, the hook returns `Disabled`.
 * @returns An `AsyncState` tuple for the Data URI (containing the DataUri and setter), or `Disabled` if either `id` or `context` is `Disabled`.
 */
export const useManagedUriItem = (
  id: string | Disabled,
  context: ManagedUriStorage | Disabled,
): AsyncState<DataUri | null> | Disabled => {
  const { getUri, setUri, items } = context ?? {};

  const [value, setValue] = useAsyncState<DataUri | null>(undefined);

  // Tracks changes in items for the current id.
  const [item, setItem] = useRecordItem([items, undefined], id);

  // On mount or when id or item changes, fetch the current URI.
  useEffect(() => {
    if (id && getUri && setValue) {
      getUri(id).then(setValue);
    }
  }, [id, getUri, setValue, item]);

  const mySetter: AsyncDispatch<DataUri | null> | undefined = useMemo(
    () =>
      id && setUri && setValue
        ? async (uri) => setUri(id, await getActionValue(uri, value ?? null))
        : undefined,
    [id, setUri, value, setValue],
  );

  return [value, mySetter];
};
