import {
  AsyncDispatch,
  AsyncState,
  getActionValue,
  useAsyncState,
  useRecordItem,
  useRecordKeys,
} from "@dwidge/hooks-react";
import { dropUndefined } from "@dwidge/utils-js";
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
  getUri?: (id: string) => Promise<DataUri | null | undefined>;
  /**
   * Sets the DataUri for the given id.
   * Passing null will delete the URI data and mark the id as null.
   */
  setUri?: (
    id: string,
    data: DataUri | null | undefined,
  ) => Promise<DataUri | null | undefined>;
  /**
   * Clears cache for the given id. Does not mark the id as null.
   */
  deleteUri?: (id: string) => Promise<null>;
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

  const [items, setItems] = useState<Record<string, {}> | undefined>(undefined);

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

  const myDeleteUri = useMemo(
    () =>
      deleteUri
        ? async (id: string) => {
            await deleteUri(id);
            setItems(
              (prev) =>
                dropUndefined({ ...prev, [id]: undefined }) as Record<
                  string,
                  {}
                >,
            );
            return null;
          }
        : undefined,
    [deleteUri, setItems],
  );

  const mySetUri = useMemo(
    () =>
      setUri && myDeleteUri
        ? async (id: string, data: DataUri | null | undefined) => {
            if (data === undefined) return myDeleteUri(id);

            await setUri(id, data);
            setItems((prev) => ({ ...prev, [id]: {} }));
            return data;
          }
        : undefined,
    [setUri, setItems],
  );

  const myReset = useMemo(
    () =>
      reset
        ? async () => {
            await reset();
            setItems({});
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
      deleteUri: myDeleteUri,
      reset: myReset,
    }),
    [ids, items, mySetUri, myReset, myDeleteUri],
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
): AsyncState<DataUri | null | undefined> | Disabled => {
  const { getUri, setUri, items } = context ?? {};

  const [value, setValue] = useAsyncState<DataUri | null | undefined>(
    undefined,
  );

  const [item, setItem] = useRecordItem([items, undefined], id);

  useEffect(() => {
    if (id && getUri && setValue) {
      getUri(id).then((v) => setValue(v ?? undefined));
    }
  }, [id, getUri, setValue, item]);

  const mySetter: AsyncDispatch<DataUri | null | undefined> | undefined =
    useMemo(
      () =>
        id && setUri && setValue
          ? async (uri) => setUri(id, await getActionValue(uri, value ?? null))
          : undefined,
      [id, setUri, value, setValue],
    );

  return [value, mySetter];
};
