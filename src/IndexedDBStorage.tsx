import { DataUri } from "./types";
import { UriStorage, assertStorageAvailable } from "./UriStorage";

export class IndexedDBStorage implements UriStorage {
  private dbVersion = 1; // Increment database version to trigger onupgradeneeded
  private scope: string;
  private db: Promise<IDBDatabase>;
  private objectStoreName: string;

  constructor(scope: string) {
    this.scope = `${scope}`;
    this.objectStoreName = "UriStorage";
    this.db = initializeDatabase(
      this.scope,
      this.dbVersion,
      this.objectStoreName,
    );
  }

  private async runRequest<T>(
    transactionMode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest,
    handleUndefinedResult: boolean = false,
  ): Promise<T | null> {
    assertStorageAvailable(
      "IndexedDBStorage",
      typeof indexedDB !== "undefined",
    );
    const objectStoreName = this.objectStoreName;
    const db = await this.db;

    if (!db.objectStoreNames.contains(objectStoreName))
      throw this.createError(
        "objectStoreCheck",
        `Object store "${objectStoreName}" not found. This should not happen if database initialization is correct.`,
        {
          objectStoreName,
          dbObjectStoreNames: Array.from(db.objectStoreNames),
        },
      );

    return new Promise((resolve, reject) => {
      try {
        // Add try-catch block around transaction creation
        const transaction = db.transaction([objectStoreName], transactionMode);
        const store = transaction.objectStore(objectStoreName);
        const request = operation(store);

        request.onsuccess = (event) => {
          let result = (event.target as IDBRequest<T>).result;
          if (handleUndefinedResult && result === undefined) {
            resolve(null);
          } else {
            resolve(result);
          }
        };

        request.onerror = (event) => {
          reject(
            this.createError(
              "request",
              (event.target as IDBRequest)?.error?.message,
            ),
          );
        };

        transaction.onerror = (event) => {
          reject(
            this.createError(
              "transaction",
              (event.target as IDBRequest)?.error?.message,
            ),
          );
        };
      } catch (transactionError) {
        // Catch transaction creation error
        reject(this.createError("transactionCreate", String(transactionError))); // Reject promise if transaction fails to create
      }
    });
  }

  private createError(
    operation: string,
    message: string | null | undefined,
    extraContext?: Record<string, any>,
  ) {
    return new Error(`IndexedDBStorageE: ${operation} error: ${message}`, {
      cause: {
        scope: this.scope,
        objectStoreName: this.objectStoreName,
        operation,
        message,
        ...extraContext,
      },
    });
  }

  getUri = async (id: string): Promise<DataUri | null> => {
    return this.runRequest<DataUri>("readonly", (store) => store.get(id), true);
  };

  setUri = async (id: string, uri: DataUri | null): Promise<DataUri | null> => {
    if (uri === null) {
      // Store null directly in IndexedDB for null URI
      return this.runRequest<DataUri>("readwrite", (store) =>
        store.put(null, id),
      ).then(() => null);
    }
    return this.runRequest<DataUri>("readwrite", (store) => store.put(uri, id));
  };

  deleteUri = async (id: string): Promise<null> => {
    return this.runRequest<null>("readwrite", (store) => store.delete(id));
  };

  getIds = async (): Promise<string[]> => {
    return this.runRequest<IDBValidKey[]>("readonly", (store) =>
      store.getAllKeys(),
    ).then((keys) => (keys || []).map(String)) as Promise<string[]>; // Ensure keys is not null
  };

  reset = async (): Promise<void> => {
    return this.runRequest<void>("readwrite", (store) => store.clear()).then(
      () => {},
    );
  };
}

const initializeDatabase = (
  dbName: string,
  dbVersion: number,
  objectStoreName: string,
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    assertStorageAvailable(
      "IndexedDBStorage",
      typeof indexedDB !== "undefined",
    );
    const request = indexedDB.open(dbName, dbVersion);

    request.onerror = (event) => {
      reject(
        new Error(
          `IndexedDBStorageE: dbOpen error: ${(event.target as IDBRequest)?.error?.message}`,
          {
            cause: {
              dbName,
              operation: "dbOpen",
              message: (event.target as IDBRequest)?.error?.message,
            },
          },
        ),
      );
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBRequest<IDBDatabase>).result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBRequest<IDBDatabase>).result;
      if (!db.objectStoreNames.contains(objectStoreName)) {
        db.createObjectStore(objectStoreName);
      }
    };
  });
