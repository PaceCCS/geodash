import { Schema } from "effect";

export const OlgaSourceSchema = Schema.Struct({
  type: Schema.Literal("Source"),
  pressure: Schema.Number.pipe(
    Schema.annotations({ title: "Inlet pressure (bar)" })
  ),
  temperature: Schema.Number.pipe(
    Schema.annotations({ title: "Inlet temperature (°C)" })
  ),
  flow_rate: Schema.Number.pipe(
    Schema.annotations({ title: "Mass flow rate (kg/s)" })
  ),
  fluid_id: Schema.optional(
    Schema.String.pipe(Schema.annotations({ title: "Fluid label" }))
  ),
});

export type OlgaSource = Schema.Schema.Type<typeof OlgaSourceSchema>;
