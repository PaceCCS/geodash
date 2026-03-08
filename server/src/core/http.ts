import { Data, Effect, Either } from "effect";

export class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}> {}

export const badRequest = (
  message: string,
  details?: unknown,
): HttpError =>
  new HttpError({ status: 400, code: "bad_request", message, details });

export const forbidden = (
  message: string,
  details?: unknown,
): HttpError =>
  new HttpError({ status: 403, code: "forbidden", message, details });

export const notFound = (
  message: string,
  details?: unknown,
): HttpError =>
  new HttpError({ status: 404, code: "not_found", message, details });

export const internalError = (
  message: string,
  details?: unknown,
): HttpError =>
  new HttpError({ status: 500, code: "internal_error", message, details });

export const tryPromise = <A>(
  thunk: () => Promise<A>,
  onError: (error: unknown) => HttpError,
): Effect.Effect<A, HttpError> =>
  Effect.tryPromise({
    try: thunk,
    catch: onError,
  });

export async function runRequest<A>(
  effect: Effect.Effect<A, HttpError>,
  set: { status?: number | string },
): Promise<A | { error: string; message: string; details?: unknown }> {
  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isRight(result)) {
    return result.right;
  }

  set.status = result.left.status;
  return {
    error: result.left.code,
    message: result.left.message,
    details: result.left.details,
  };
}
