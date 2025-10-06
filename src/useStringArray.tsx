import { Json, useConvert } from "@dwidge/hooks-react";
import { z } from "zod";

/**
 * A converter hook to transform JSON into an array of strings.
 */
export const useStringArray = useConvert<Json, string[]>(
  (v: Json) => z.string().array().nullable().parse(v) ?? [],
  (v: string[]) => z.string().array().parse(v),
);
