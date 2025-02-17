import Axios, { AxiosError, AxiosResponse, isAxiosError } from "axios";
import { Buffer } from "buffer";
import { BufferBin, getMetaFromBuffer, MetaBin } from "./uri.js";

export const putBufferToUrl = async ({
  data = {} as BufferBin,
  url = "",
  axios = Axios.create(),
}): Promise<void> => {
  await axios
    .put(url, data.buffer, {
      headers: {
        "Content-Type": data.mime,
      },
    })
    .catch((e) => {
      if (!isAxiosError(e)) throw e;
      throw newSimpleAxiosError(e);
    });
};

export const getBufferFromUrl = async ({
  url = "",
  axios = Axios.create(),
}): Promise<BufferBin | null> => {
  const response = await axios
    .get(url, {
      responseType: "arraybuffer",
    })
    .catch((e) => {
      if (!isAxiosError(e)) throw e;
      if (e.response?.status === 404) return null;
      throw newSimpleAxiosError(e);
    });

  return response ? getBufferFromAxiosResponse(response) : null;
};

const getBufferFromAxiosResponse = (
  response: AxiosResponse<any, any>,
): BufferBin => {
  const buffer = Buffer.from(response.data);
  if (!buffer)
    throw new Error(
      "getMimeBufferAxiosResponseE1: Received empty response buffer",
      {
        cause: response,
      },
    );
  const mime = response.headers["content-type"] || "application/octet-stream";
  return { buffer, mime };
};

const newSimpleAxiosError = (e: AxiosError) =>
  new Error(e.message, {
    cause: {
      code: e.code,
      response: e.response,
      config: { url: e.config?.url },
    },
  });

const isMetaEqual = (a: MetaBin, b: MetaBin) =>
  a.mime === b.mime && a.size === b.size && a.sha256 === b.sha256;

const assertMetaEqual = (
  actual: MetaBin,
  expected: MetaBin,
  message?: string,
) => {
  if (!isMetaEqual(actual, expected)) {
    throw new Error(
      message ??
        `assertMetaEqualE1: Mismatch: ${JSON.stringify({
          actual,
          expected,
        })}`,
      {
        cause: {
          actual,
          expected,
        },
      },
    );
  }
};

export const getBufferFromUrlAndVerify = async ({
  getUrl = "",
  meta = {} as MetaBin,
  axios = Axios.create(),
}): Promise<BufferBin | null> => {
  const fetchedBufferBin = await getBufferFromUrl({ url: getUrl, axios });
  if (!fetchedBufferBin) return null;

  const fetchedMeta = await getMetaFromBuffer(fetchedBufferBin);
  assertMetaEqual(fetchedMeta, meta);

  return fetchedBufferBin;
};

export const putBufferToUrlAndVerify = async ({
  data = {} as BufferBin,
  putUrl = "",
  getUrl = "",
  meta = {} as MetaBin,
  axios = Axios.create(),
}): Promise<void> => {
  const calculatedMeta = await getMetaFromBuffer(data);
  assertMetaEqual(calculatedMeta, meta);

  await putBufferToUrl({ data, url: putUrl, axios });
  await getBufferFromUrlAndVerify({ getUrl, meta, axios });
};
