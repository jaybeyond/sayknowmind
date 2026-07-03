/**
 * Instant navigation feedback for the dashboard content pane.
 *
 * The (shell) layout persists across menu navigation, but its routes are
 * `force-dynamic`, so a click still triggers a server RSC round-trip. This
 * Suspense boundary means the sidebar stays put and the content area is replaced
 * by this placeholder *immediately* on click (and it makes the routes
 * prefetchable up to here), instead of the previous page lingering until the
 * fetch resolves. Each content component then swaps in its own skeleton + data.
 */
export default function ShellLoading() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-center bg-container h-full w-full bg-background">
      <div
        className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
