import { Elysia, type AnyElysia } from "elysia";

type OperationPrefix = `/${string}`;
type NonApiOperationPrefix<TPrefix extends OperationPrefix> =
  TPrefix extends `/api/${string}` ? never : TPrefix;

export type FlowModuleFactory<Env, TModule> = (env: Env) => TModule;

export function createModule<Env, TModule>(
  build: FlowModuleFactory<Env, TModule>,
): FlowModuleFactory<Env, TModule> {
  return build;
}

export function createOperationsApp(): Elysia<"/api/operations"> {
  return new Elysia({ prefix: "/api/operations" });
}

export function createOperationModule<
  Env,
  const TPrefix extends OperationPrefix,
  TApp extends AnyElysia,
>(options: {
  readonly prefix: NonApiOperationPrefix<TPrefix>;
  readonly register: (
    app: Elysia<NonApiOperationPrefix<TPrefix>>,
    env: Env,
  ) => TApp;
}): FlowModuleFactory<Env, TApp> {
  return createModule((env) =>
    options.register(new Elysia({ prefix: options.prefix }), env),
  );
}
