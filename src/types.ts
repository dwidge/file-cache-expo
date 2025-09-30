/**
 * @module fileCache/types
 */

import { AsyncState } from "@dwidge/hooks-react";

export type FileUri = string & { readonly __brand: "FileUri" };
/** Data URI type alias. */
export type DataUri = string & { readonly __brand: "DataUri" };
/** Represents a SHA-256 hash in hex format. */
export type Sha256Hex = string;
export type Base64 = string;
/** Represents the MIME type of a file. */
export type MIME = string;
/** Represents an unsigned integer.*/
export type Uint = number;

/**
 * File record from api.
 */
export type FileRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  getUrl?: string | null;
  putUrl?: string | null;
  mime: MIME | null;
  size: Uint | null;
  sha256: Sha256Hex | null;
};

/**
 * File metadata information.
 */
export type FileMeta = {
  mime: MIME;
  size: Uint;
  sha256: Sha256Hex;
};

/**
 * Function to fetch file signed URLs from the remote API.
 * Should return a FileMeta containing at least the `putUrl` and `getUrl`.
 */
export type GetFileUrls = (
  v: Pick<FileRecord, "id">,
) => Promise<Partial<Pick<FileRecord, "putUrl" | "getUrl">> | null>;

/** File identifier type. */
export type FileId = string;
/** Deleted files are represented by `null`. */
export type Deleted = null;
/** Loading state is represented by `undefined`. */
export type Loading = undefined;
/** Disabled state is represented by `undefined`. */
export type Disabled = undefined;

export type UseFileRecord = AsyncState<Partial<FileRecord> | null>;
