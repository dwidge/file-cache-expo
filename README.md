# 📖 File Cache System

This document and code implement a File Cache System built on React hooks, designed for efficient file caching and synchronization between local storage and remote file storage. It supports pending uploads, automatic cache eviction, and prioritizes important data like pending and actively used files.

---

## 🗂️ Table of Contents

1. [📖 Overview](#overview)
2. [✨ Key Features](#key-features)
3. [🏗️ Architecture and Design Details](#architecture-and-design-details)
   - [💾 Local Caching](#local-caching)
   - [📡 Remote Synchronization](#remote-synchronization)
   - [📤 Pending Uploads](#pending-uploads)
   - [🗑️ Cache Eviction Strategy](#cache-eviction-strategy)
   - [🥇 Prioritization & Peeking Order](#prioritization--peeking-order)
4. [🔗 Hooks API and Provider](#hooks-api-and-provider)
5. [⚠️ Error Handling and Edge Cases](#error-handling-and-edge-cases)
6. [🚀 Future Enhancements](#future-enhancements)
7. [📜 License](#license)

---

## 📖 Overview

The File Cache System offers a comprehensive solution for managing file data URIs locally, ensuring synchronization with a remote file storage system. Key functionalities include:

- **Local Caching:** Storing files locally as DataURIs for rapid access.
- **Remote Sync:** Downloading files missing from the cache and uploading pending files to remote storage.
- **Pending Uploads Management:** Tracking files marked for upload to prevent accidental eviction.
- **Cache Eviction:** Automatically evicting the oldest, non-pending files when the cache exceeds its configured limit.
- **React Hooks API:** Providing easy-to-use hooks like `useFileUri` and `useFileCacheSync` for seamless integration into React applications.

---

## ✨ Key Features

- **Local Caching:**

  - Employs platform-specific local storage to store file DataURIs, enabling instant file retrieval without network requests.

- **Remote Synchronization:**

  - Facilitates downloading missing files from a remote source and uploading modified or pending files.
  - Supports:
    1. **Sync-Up:** Uploads all pending files to remote storage.
    2. **Sync-Down:** Refreshes the local cache by downloading recent files from the remote source.
    3. **On-Demand Sync:** Downloads specific files from remote storage if they are not in the cache and the remote source is accessible.

- **Pending Uploads Management:**

  - Maintains a separate list of pending file IDs. These files are given the highest priority and are protected from eviction until successfully uploaded, ensuring no data loss.

- **Cache Eviction:**

  - Implements an intelligent eviction strategy. When adding a new file would exceed the `maxCache` limit, the system evicts the oldest cached file that is not in the pending, mounted, or recent lists. An error is thrown if all cached items are pending, preventing data loss.

- **Prioritization & Pecking Order:**
  - Establishes a clear hierarchy for cache importance:
    1. **Pending Items:** Never evicted until uploaded.
    2. **Mounted Items:** Files currently in use via `useFileUri` hooks are prioritized.
    3. **Recent Items:** Files recently accessed are kept in cache for quicker access.
    4. **Cacheable List Items:** Files from a remote-provided cacheable list, ordered by recency, fill remaining cache space.

---

## 🏗️ Architecture and Design Details

### 💾 Local Caching

- **Storage:**

  - Utilizes a platform-specific local storage interface.

- **Data Processing:**
  - On setting a new DataURI, it will extract the binary buffer and compute metadata (size, MIME type, SHA-256 hash). This metadata is stored with the file record.

### 📡 Remote Synchronization

- **Download:**

  - Uses a `downloadFile` function to retrieve remote files given a file ID. This involves fetching signed URLs, verifying the downloaded binary, and converting it to a DataURI.

- **Upload:**

  - Employs an `uploadFile` function to push pending files to remote storage. Successful uploads remove the file ID from the pending list while keeping the file in the cache.

- **Sync Function:**
  - The `sync()` function orchestrates synchronization:
    1. **Upload Pending Files:** Iterates through the pending list and uploads each file.
    2. **Refresh Cache:** Downloads missing files from the remote source based on a cacheable list, adding new items and evicting old ones as needed.

### 📤 Pending Uploads

- **Tracking:**

  - A separate list of pending file IDs is maintained. When a local file is updated and marked pending, its ID is added to this list.

- **Upload Flow:**
  - During synchronization, each pending file is uploaded. Upon successful upload, the ID is removed from the pending list but remains cached.

### 🗑️ Cache Eviction Strategy

- **Eviction Trigger:**

  - When a new file is added, the system checks if the cache size exceeds `maxCache`.

- **Eviction Rules:**

  - **Non-Pending Items:** Only files not in the pending list are considered for eviction.
  - **Order:** Eviction targets the oldest file in the cache.
  - **Pending Items Overload:** If all cached items are pending upload and cannot be evicted, adding a new file results in an error to prevent exceeding cache limit.

- **Dynamic Cache Management:**
  - The system monitors changes in `maxCache` and the cacheable list, removing files that are no longer cacheable or exceed the dynamic threshold (`maxCache - pendingCount`).

### 🥇 Prioritization & Pecking Order

The system prioritizes files for caching in the following order:

1. **Pending Items:** Always kept due to unsynchronized changes. These represent the only copy in existence, so must be protected until uploaded.
2. **Mounted Items (Active Hooks):** Files actively used via `useFileUri` hooks.
3. **Recent Items:** Files recently accessed, tracked to improve cache hit rate.
4. **Cacheable List:** Files from a remotely provided list, ordered by recency, filling remaining cache space.

---

## 🔗 Hooks API and Provider

### Provider: `FileCacheProvider`

The `FileCacheProvider` component makes the following API available via React Context:

- **Props:**

  - `maxCache`: `number` - Maximum total items to cache.
  - `maxPending`: `number` (optional) - Maximum pending items to cache.
  - `maxMounted`: `number` (optional) - Maximum mounted items to auto-fetch when online.
  - `maxRecent`: `number` - Maximum recent items to keep in cache.
  - `isOnline`: `boolean` - Flag indicating online status, enabling auto-fetching of mounted ids.
  - `getCacheableIds`: `(maxItemsToCache: number) => Promise<FileId[] | undefined>` (optional) - Function to fetch cacheable file IDs, ordered by recency.
  - `uploadFile`: `(id: FileId, data: DataUri | Deleted) => Promise<void>` (optional) - Function to upload a file.
  - `downloadFile`: `(id: FileId) => Promise<DataUri | Deleted>` (optional) - Function to download a file.
  - `cacheStorage`: `ManagedUriStorage` (optional) - Custom storage implementation.
  - `pendingIds`: `AsyncState<FileId[]>` (optional) - Custom pending IDs state.

- **Context API:**
  - `useItem(fileId?: FileId)`: `() => AsyncState<DataUri | null> | Disabled` - Hook to get a file's DataURI and setter.
  - `useCacheList(): () => FileId[] | Loading` - Hook to get an array of cached file IDs.
  - `usePendingList(): () => FileId[] | Loading` - Hook to get an array of pending file IDs.
  - `useRecentList(): () => FileId[] | Loading` - Hook to get an array of recent file IDs.
  - `sync(options?: { signal?: AbortSignal; onProgress?: (progress: number) => void }): () => Promise<void> | undefined` - Function to trigger synchronization.
  - `reset(): () => Promise<void> | undefined` - Function to reset the file cache. Dangerous - it will clear pending files too, but useful for secure logout.

### 💡 Usage Example

```tsx
import React from "react";
import {
  FileCacheProvider,
  useFileUri,
  useFileCacheSync,
} from "./fileCache/provider";
import App from "./App";

// Replace these with your actual implementations.
const getFileUrls = async ({ id }: { id: string }) => ({
  id,
  getUrl: `https://example.com/files/${id}`,
  putUrl: `https://example.com/files/${id}`,
  mime: "image/png",
  size: 12345,
  sha256: "abcdef1234567890",
  updatedAt: (Date.now() / 1000) | 0,
});
const uploadFile = async (id: string, dataUri: string) => {
  console.log(`Uploading file ${id} with data: ${dataUri}`);
};
const downloadFile = async (id: string) => {
  // Simulate download logic.
  return `data:image/png;base64,...`;
};

const Root = () => (
  <FileCacheProvider
    maxCache={50}
    maxPending={10}
    maxRecent={10}
    isOnline={true}
    getCacheableIds={async (max) => {
      // Example: Return a static list or fetch from API.
      return ["file-1", "file-2", "file-3", "file-4", "file-5"].slice(0, max);
    }}
    uploadFile={uploadFile}
    downloadFile={downloadFile}
  >
    <App />
  </FileCacheProvider>
);

export default Root;
```

## Using the Hooks

```tsx
import React from "react";
import { useFileUri, useFileCacheSync } from "./fileCache/provider";

const FileDisplay: React.FC<{ fileId: string }> = ({ fileId }) => {
  const [dataUri, setDataUri] = useFileUri(fileId);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setDataUri(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDelete = () => {
    setDataUri(null);
  };

  return (
    <div>
      {dataUri ? (
        <>
          <img
            src={dataUri}
            alt="Cached file"
            style={{ maxWidth: "200px", maxHeight: "200px" }}
          />
          <button onClick={handleDelete}>🗑️ Delete</button>
        </>
      ) : (
        <>
          <p>Loading file...</p>
          <input type="file" accept="image/*" onChange={handleFileChange} />
        </>
      )}
    </div>
  );
};

const SyncButton: React.FC = () => {
  const sync = useFileCacheSync();

  return <button onClick={() => sync()}>🔄 Sync Files</button>;
};

export default function App() {
  return (
    <div>
      <h1>File Cache Demo</h1>
      <FileDisplay fileId="file-123" />
      <SyncButton />
    </div>
  );
}
```

### 🎣 Hook: `useFileUri`

- Provides access to a file's DataURI from the cache.
- Returns `null` if the file is not cached.
- Utilizes local and remote synchronization to ensure the cache is updated.
- Returns an async state tuple `[dataUri, setDataUri]`.

### 🔄 Hook: `useFileCacheSync`

- Returns the `sync` function.
- Calling `sync()` triggers:
  1. Upload of pending files.
  2. Refresh of the cache with recently accessed and updated files from the remote source, respecting cache limits and pending priorities.

### 🗂️ Hook: `useCacheList`

- Returns an array of file IDs currently in the cache.
- Useful for displaying cached files or managing cache state.

### 📤 Hook: `usePendingList`

- Returns an array of file IDs that are pending upload.
- Allows monitoring and management of pending uploads.

### ⏱️ Hook: `useRecentList`

- Returns an array of file IDs that have been recently accessed.
- Helps in understanding file usage patterns and cache prioritization.

### 🔄 Hook: `useFileCacheReset`

- Returns the `reset` function.
- Calling `reset()` clears the entire file cache, including cached files and all lists (pending, recent, mounted).
- Useful for cache invalidation or secure logout.

---

## ⚠️ Error Handling and Edge Cases

- **Cache Full of Pending Items:**

  - Adding a new file when all cached items are pending and the cache limit is reached results in an error to prevent losing the only local copy of pending files.

- **Incomplete File Metadata:**

  - Logs warnings during remote fetch/upload processes if file metadata (size, MIME type, SHA-256) is incomplete.

- **Eviction Failure:**

  - Throws an error if no non-pending item can be evicted when a new item needs caching, indicating a full cache and potential issues with pending or mounted files.

- **Concurrent Operations:**
  - Current implementation processes uploads/downloads sequentially. Future versions may implement configurable concurrency.

---

## 🚀 Future Enhancements

- **Concurrent Uploads:**

  - Implement configurable concurrent uploads to improve performance with multiple pending files.

- **Total File Size Limits:**

  - Limit the cache with a max total file size rather than max file count.

- **Enhanced Error Recovery:**

  - Implement more robust error handling and recovery for upload and download failures, including retry mechanisms and user notifications.

- **Progress Reporting for Sync:**

  - Provide detailed progress updates during sync operations, including individual file upload/download status and overall progress percentage.

- **Download Mounted Files Only When Idle:**
  - Only download on demand items if not busy syncing, to prevent double fetching.

---

## 📜 License

Copyright DWJ 2025.  
Distributed under the Boost Software License, Version 1.0.  
https://www.boost.org/LICENSE_1_0.txt
