export type GeodashServerConfig = {
  readonly serviceName: string;
  readonly port: number;
};

export function createGeodashServerConfig(): GeodashServerConfig {
  return {
    serviceName: "geodash-api",
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3001,
  };
}
