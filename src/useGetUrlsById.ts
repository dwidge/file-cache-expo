import { ApiGetList } from "@dwidge/crud-api-react";
import { Disabled, FileId, FileRecord } from "./types";

export type GetSignedUrlsById = (
  ids: FileId[],
) => Promise<
  (Pick<
    FileRecord,
    "getUrl" | "putUrl" | "id" | "size" | "mime" | "sha256"
  > | null)[]
>;

export const useGetUrlsById = (
  getFiles?: ApiGetList<FileRecord>,
): GetSignedUrlsById | Disabled =>
  getFiles
    ? async (ids) => {
        if (ids.length === 0) {
          return [];
        }
        const files = await getFiles(
          { id: ids },
          { columns: ["getUrl", "putUrl", "id", "size", "mime", "sha256"] },
        );
        const filesById = new Map(files.map((f) => [f.id, f]));
        return ids.map((id) => {
          const file = filesById.get(id);
          return file ?? null;
        });
      }
    : undefined;
