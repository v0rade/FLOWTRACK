export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 lg:pl-72 space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-64 rounded-lg bg-slate-200" />
          <div className="h-4 w-96 rounded-lg bg-slate-200/70" />
        </div>
        <div className="h-8 w-40 rounded-lg bg-slate-200" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl border border-slate-200 bg-white p-4 space-y-3"
          >
            <div className="h-3.5 w-28 rounded bg-slate-200" />
            <div className="h-6 w-36 rounded bg-slate-200" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="h-72 rounded-xl border border-slate-200 bg-white p-5" />
        <div className="h-72 rounded-xl border border-slate-200 bg-white p-5" />
      </div>
    </div>
  );
}
