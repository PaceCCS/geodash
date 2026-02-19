import { Schema } from "effect";

export const OlgaCompressorSchema = Schema.Struct({
  type: Schema.Literal("Compressor"),
  differential_pressure: Schema.optional(
    Schema.Number.pipe(Schema.annotations({ title: "Differential pressure (bar)" }))
  ),
  efficiency: Schema.optional(
    Schema.Number.pipe(Schema.annotations({ title: "Isentropic efficiency (0–1)" }))
  ),
});

export type OlgaCompressor = Schema.Schema.Type<typeof OlgaCompressorSchema>;
