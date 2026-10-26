"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 mb-3">
        <AlertTriangle className="size-6" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">
        Something went wrong while loading this view
      </h2>
      <p className="text-xs text-slate-500 max-w-md mt-1">
        {error.message || "An unexpected operational error occurred. Please retry."}
      </p>
      <div className="mt-4">
        <Button onClick={reset} size="sm" className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white">
          <RotateCcw className="size-3.5" />
          Retry Operation
        </Button>
      </div>
    </div>
  );
}
