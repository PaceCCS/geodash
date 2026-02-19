import { Schema } from "effect";

export const OlgaPipeSchema = Schema.Struct({
  type: Schema.Literal("Pipe"),
  diameter: Schema.Number.pipe(
    Schema.greaterThan(0),
    Schema.annotations({ title: "Inner diameter (m)" })
  ),
  roughness: Schema.Number.pipe(
    Schema.greaterThan(0),
    Schema.annotations({ title: "Roughness (m)" })
  ),
  route: Schema.optional(
    Schema.String.pipe(Schema.annotations({ title: "Route shapefile path" }))
  ),
  length: Schema.optional(
    Schema.Number.pipe(Schema.annotations({ title: "Length (m)" }))
  ),
  elevation: Schema.optional(
    Schema.Number.pipe(Schema.annotations({ title: "Elevation change (m)" }))
  ),
  nsegment: Schema.optional(
    Schema.Number.pipe(Schema.annotations({ title: "OLGA segments" }))
  ),
});

export type OlgaPipe = Schema.Schema.Type<typeof OlgaPipeSchema>;
