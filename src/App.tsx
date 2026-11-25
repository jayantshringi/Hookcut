export function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800/80 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm">
            CF
          </span>
          <span className="text-lg font-semibold tracking-tight">ClipForge</span>
        </div>
        <span className="text-xs text-zinc-400">100% On-Device • Zero Uploads</span>
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-zinc-400">Initializing ClipForge studio…</p>
      </main>
    </div>
  );
}

export default App;
