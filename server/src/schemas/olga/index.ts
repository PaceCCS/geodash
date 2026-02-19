export { OlgaPipeSchema, type OlgaPipe } from "./pipe";
export { OlgaSourceSchema, type OlgaSource } from "./source";
export { OlgaSinkSchema, type OlgaSink } from "./sink";
export { OlgaCompressorSchema, type OlgaCompressor } from "./compressor";

import { OlgaPipeSchema } from "./pipe";
import { OlgaSourceSchema } from "./source";
import { OlgaSinkSchema } from "./sink";
import { OlgaCompressorSchema } from "./compressor";

export const olgaSchemaRegistry = {
  "v1.0-olga": {
    Pipe: OlgaPipeSchema,
    Source: OlgaSourceSchema,
    Sink: OlgaSinkSchema,
    Compressor: OlgaCompressorSchema,
  },
} as const;

export type OlgaBlockType = keyof (typeof olgaSchemaRegistry)["v1.0-olga"];
