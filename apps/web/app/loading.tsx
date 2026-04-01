export default function Loading() {
  return (
    <div className="min-h-svh flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
