import assert from "assert";
import { Buffer } from "buffer";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { Base64, DataUri, FileUri, MIME, Sha256Hex, Uint } from "./types.js";

export const isFileUri = (v: string): v is FileUri => v.startsWith("file:");
export const isDataUri = (v: string): v is DataUri => v.startsWith("data:");

export const asFileUri = (v: string): FileUri => (
  assert(isFileUri(v), `Not a File URI: "${v}"`),
  v
);
export const asDataUri = (v: string): DataUri => (
  assert(isDataUri(v), `Not a Data URI: "${v}"`),
  v
);

/**
 * Represents binary data with its MIME type, stored as a Buffer.
 */
export type BufferBin = {
  mime: MIME;
  buffer: Buffer;
};

/**
 * Represents metadata about binary data, including MIME type, size, and SHA256 hash.
 */
export type MetaBin = {
  mime: MIME;
  size: Uint;
  sha256: Sha256Hex;
};
export type MetaNull = {
  mime: MIME | null;
  size: Uint | null;
  sha256: Sha256Hex | null;
};

/**
 * Represents a binary as base64 encoded data, along with its metadata.
 */
export type DocBin = {
  data: Base64;
  mime: MIME;
  size: Uint;
  sha256: Sha256Hex;
};

/**
 * Zod schema for validating DocBin objects.
 * Ensures that the data, size, mime, and sha256 properties conform to the expected types and formats.
 */
const DocBinSchema = z.object({
  data: z.string().min(1),
  size: z.number().int().min(0),
  mime: z.string().min(1).max(64),
  sha256: z.string().length(64),
});

/**
 * Type guard and parser for DocBin objects using the Zod schema.
 * @param v The value to parse and validate as a DocBin.
 * @returns The parsed DocBin object.
 * @throws {z.ZodError} If the input does not conform to the DocBin schema.
 */
export const asDocBin = (v: DocBin): DocBin => DocBinSchema.parse(v);

/**
 * Creates a MetaBin object from a BufferBin object.
 * Calculates the size and SHA256 hash of the buffer.
 * @param v The BufferBin object.
 * @returns A promise resolving to a MetaBin object.
 */
export const getMetaFromBuffer = async (v: BufferBin): Promise<MetaBin> => ({
  mime: v.mime,
  size: v.buffer.byteLength,
  sha256: await getSha256HexFromBuffer(v.buffer),
});

/**
 * Extracts the MIME type from a data URI.
 * @param uri The data URI string.
 * @returns The MIME type string.
 * @throws {Error} If the URI is not a valid data URI or MIME type is missing.
 */
export const getMimeTypeFromDataUri = (uri: DataUri): MIME => {
  const mimeStartIndex = uri.indexOf(":");
  if (mimeStartIndex === -1) {
    throw new Error("Invalid data URI: Missing MIME type separator ':'");
  }
  const mimeEndIndex = uri.indexOf(";", mimeStartIndex);
  if (mimeEndIndex === -1) {
    throw new Error("Invalid data URI: Missing MIME type terminator ';'");
  }
  return uri.substring(mimeStartIndex + 1, mimeEndIndex);
};

/**
 * Extracts the base64 encoded data from a data URI.
 * @param uri The data URI string.
 * @returns The base64 encoded data string.
 * @throws {Error} If the URI is not a valid data URI or data is missing.
 */
export const getBase64FromDataUri = (uri: DataUri): Base64 => {
  const dataStartIndex = uri.indexOf(",");
  if (dataStartIndex === -1) {
    throw new Error("Invalid data URI: Missing data separator ','");
  }
  return uri.substring(dataStartIndex + 1);
};

/**
 * Gets the size in bytes of the data from a data URI.
 * @param uri The data URI string.
 * @returns The size in bytes.
 */
export const getSizeFromDataUri = (uri: DataUri): Uint =>
  getBufferFromDataUri(uri).byteLength;

/**
 * Gets the SHA256 hash in hexadecimal format of the data from a data URI.
 * @param uri The data URI string.
 * @returns A promise resolving to the SHA256 hash as a hexadecimal string.
 */
export const getSha256HexFromDataUri = async (
  uri: DataUri,
): Promise<Sha256Hex> => getSha256HexFromBuffer(getBufferFromDataUri(uri));

/**
 * Gets a Buffer from a data URI.
 * @param uri The data URI string.
 * @returns A Buffer containing the data from the URI.
 */
export const getBufferFromDataUri = (uri: DataUri): Buffer =>
  getBufferFromBase64(getBase64FromDataUri(uri));

/**
 * Gets a Buffer from a base64 encoded string.
 * @param base64 The base64 encoded string.
 * @returns A Buffer containing the decoded data.
 */
export const getBufferFromBase64 = (base64: Base64): Buffer =>
  Buffer.from(base64, "base64");

/**
 * Gets the SHA256 hash in hexadecimal format of a Buffer.
 * @param buffer The Buffer to hash.
 * @returns A promise resolving to the SHA256 hash as a hexadecimal string.
 */
export const getSha256HexFromBuffer = async (
  buffer: Buffer,
): Promise<Sha256Hex> => {
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new Uint8Array(buffer),
  );
  return Buffer.from(digest).toString("hex");
};

/**
 * Gets the base64 encoded string from a Buffer.
 * @param buffer The Buffer to encode.
 * @returns The base64 encoded string.
 */
export const getBase64FromBuffer = (buffer: Buffer): Base64 =>
  buffer.toString("base64");

/**
 * Creates a DocBin object from a data URI.
 * @param uri The data URI string.
 * @returns A promise resolving to a DocBin object.
 */
export const getDocFromDataUri = async (uri: DataUri): Promise<DocBin> => {
  const mime = getMimeTypeFromDataUri(uri);
  const data = getBase64FromDataUri(uri);
  const buffer = getBufferFromDataUri(uri);
  const size = buffer.byteLength;
  const sha256 = await getSha256HexFromBuffer(buffer);

  return asDocBin({ data, mime, size, sha256 });
};

/**
 * Creates a data URI string from a DocBin object (or a subset with data and mime).
 * @param doc An object conforming to Pick<DocBin, "data" | "mime">.
 * @returns The data URI string.
 */
export const getDataUriFromDoc = (
  doc: Pick<DocBin, "data" | "mime">,
): DataUri => asDataUri(`data:${doc.mime};base64,${doc.data}`);

/**
 * Creates a DocBin object from a BufferBin object.
 * @param bin The BufferBin object.
 * @returns A promise resolving to a DocBin object.
 */
export const getDocFromBufferBin = async (bin: BufferBin): Promise<DocBin> => {
  const meta = await getMetaFromBuffer(bin);
  const base64 = getBase64FromBuffer(bin.buffer);
  return asDocBin({
    data: base64,
    mime: meta.mime,
    size: meta.size,
    sha256: meta.sha256,
  });
};

/**
 * Creates a BufferBin object from a DataUri string.
 * @param uri The DataUri string.
 * @returns A BufferBin object.
 */
export const getBufferBinFromDataUri = (uri: DataUri): BufferBin => {
  const mime = getMimeTypeFromDataUri(uri);
  const buffer = getBufferFromDataUri(uri);
  return { mime, buffer };
};

/**
 * Creates a MetaBin object from a DataUri string.
 * @param uri The DataUri string.
 * @returns A promise resolving to a MetaBin object.
 */
export const getMetaFromDataUri = async (uri: DataUri): Promise<MetaBin> => {
  const mime = getMimeTypeFromDataUri(uri);
  const size = getSizeFromDataUri(uri);
  const sha256 = await getSha256HexFromDataUri(uri);
  return { mime, size, sha256 };
};

/**
 * Creates a MetaBin object from a DataUri string.
 * @param uri The DataUri string.
 * @returns A promise resolving to a MetaBin object.
 */
export const getMetaOrNullFromDataUriOrNull = async (
  uri: DataUri | null,
): Promise<MetaNull> =>
  uri === null
    ? { mime: null, size: null, sha256: null }
    : getMetaFromDataUri(uri);

/**
 * Creates a DataUri string from a BufferBin object.
 * @param bin The BufferBin object.
 * @returns The DataUri string.
 */
export const getDataUriFromBufferBin = (bin: BufferBin): DataUri => {
  const base64 = getBase64FromBuffer(bin.buffer);
  return asDataUri(`data:${bin.mime};base64,${base64}`);
};

/** Generate filename from id and MIME */
export const getFilenameFromIdMime = (id: string, mime: MIME): string => {
  const mimeParts = mime.split("/");
  return `${id}.${mimeParts.join(".")}`;
};

/** Extract id and MIME from filename */
export const getIdMimeFromFilename = (
  filename: string,
): { id: string; mime: MIME | undefined } => {
  const parts = filename.split(".");
  const id = parts[0];
  const mime = parts.slice(1).join("/") as MIME;
  return { id, mime };
};

/**
 * Extract DataUri binary buffer and metadata.
 *
 * @param uri - The file’s data URI.
 * @returns An object containing metadata (or cleared values) and, if available, the binary buffer.
 */
export const getMetaBufferFromDataUri = async (
  uri: DataUri | null,
): Promise<{
  meta: MetaBin;
  buffer: BufferBin;
} | null> => {
  if (uri === null) {
    return null;
  } else {
    const localBuffer = getBufferBinFromDataUri(uri);
    const meta = await getMetaFromBuffer(localBuffer);
    return { meta, buffer: localBuffer };
  }
};
