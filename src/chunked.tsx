/**
 * Process an array of items in chunks.
 *
 * This function takes an array of items, splits it into chunks of a specified size,
 * processes each chunk with a provided asynchronous function, and then flattens
 * the results into a single array.
 *
 * @template T The type of the items in the input array.
 * @template U The type of the items in the output array.
 * @param {T[]} items The array of items to process.
 * @param {number} chunkSize The size of each chunk.
 * @param {(chunk: T[]) => Promise<U[]>} processChunk The asynchronous function to process each chunk.
 * @returns {Promise<U[]>} A promise that resolves to a flattened array of the results from processing each chunk.
 */
export const processInChunks = async <T, U>(
  items: T[],
  chunkSize: number,
  processChunk: (chunk: T[]) => Promise<U[]>,
): Promise<U[]> => {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  const resultChunks = await Promise.all(
    chunks.map((chunk) => processChunk(chunk)),
  );

  return resultChunks.flat();
};
