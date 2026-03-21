export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-xl border border-border bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {children}
      </div>
    </div>
  );
}
