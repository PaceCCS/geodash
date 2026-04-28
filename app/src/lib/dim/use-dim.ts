import { useEffect, useState } from "react";
import { evalStructured, type DimEvalResult } from "./dim";
import { useDimReady } from "./use-dim-ready";

type SuccessResponse = {
  status: "success";
  results: DimEvalResult[];
  error: undefined;
};

type ErrorResponse = {
  status: "error";
  results: undefined;
  error: Error;
};

type IdleResponse = {
  status: "idle";
  results: undefined;
  error: undefined;
};

type LoadingResponse = {
  status: "loading";
  results: undefined;
  error: undefined;
};

type DimResponse =
  | SuccessResponse
  | ErrorResponse
  | IdleResponse
  | LoadingResponse;

type Options = {
  silenceErrors?: boolean;
};

export function useDim(expressions: string[], options?: Options): DimResponse {
  const { silenceErrors = false } = options || {};
  const ready = useDimReady();
  const [status, setStatus] = useState<DimResponse["status"]>(
    ready ? "idle" : "loading"
  );
  const [results, setResults] = useState<DimEvalResult[]>([]);
  const [error, setError] = useState<Error | undefined>(undefined);
  const expressionsKey = JSON.stringify(expressions);

  useEffect(() => {
    if (!ready) return;
    const run = async () => {
      setStatus("loading");
      setResults([]);
      try {
        const newResults: DimEvalResult[] = [];
        const exprs: string[] = JSON.parse(expressionsKey);
        for (const expression of exprs) {
          const out = evalStructured(expression);
          newResults.push(out);
        }
        setResults(newResults);
        setStatus("success");
      } catch (error) {
        if (!silenceErrors) {
          console.error(error);
        }
        setError(error as Error);
        setStatus("error");
      }
    };
    void run();
  }, [expressionsKey, ready, silenceErrors]);

  switch (status) {
    case "success":
      return {
        status: "success",
        results,
        error: undefined,
      } satisfies SuccessResponse;
    case "error":
      return {
        status: "error",
        results: undefined,
        error: error!,
      } satisfies ErrorResponse;
    case "loading":
      return {
        status: "loading",
        results: undefined,
        error: undefined,
      } satisfies LoadingResponse;
    case "idle":
    default:
      return {
        status: "idle",
        results: undefined,
        error: undefined,
      } satisfies IdleResponse;
  }
}
