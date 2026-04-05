import { createOperationsApp } from "./core/operations";
import { createFlowServer } from "./core/server";
import { createGeodashServerConfig } from "./config";
import { networkModule } from "./modules/network";
import { olgaOperationModule } from "./modules/operations/olga";
import { queryModule } from "./modules/query";
import { shapefileModule } from "./modules/shapefiles";

const config = createGeodashServerConfig();

const operationsApp = createOperationsApp().use(olgaOperationModule(config));

const app = await createFlowServer({
  serviceName: config.serviceName,
  env: config,
});

const server = app
  .use(queryModule(config))
  .use(networkModule(config))
  .use(shapefileModule(config))
  .use(operationsApp);

server.listen(config.port);

console.log(
  `Elysia server running for ${config.serviceName} at http://localhost:${config.port}`,
);
