import { Schema } from "effect";

export const OlgaSinkSchema = Schema.Struct({
  type: Schema.Literal("Sink"),
  pressure: Schema.Number.pipe(
    Schema.annotations({ title: "Outlet pressure (bar)" })
  ),
  temperature: Schema.optional(
    Schema.Number.pipe(Schema.annotations({ title: "Outlet temperature (°C)" }))
  ),
});

export type OlgaSink = Schema.Schema.Type<typeof OlgaSinkSchema>;
