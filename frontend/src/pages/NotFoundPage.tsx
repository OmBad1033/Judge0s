export default function NotFoundPage() {
  return (
    <div className="dot-grid min-h-screen text-on-surface font-body flex items-center justify-center px-4">
      <div className="term-card max-w-md w-full p-6 flex flex-col gap-4 text-center">
        <span className="material-symbols-outlined text-5xl text-muted mx-auto">cloud_off</span>
        <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em]">404_Not_Found</h2>
        <p className="font-body text-body text-on-surface-variant">
          The page you tried to reach doesn't exist. If you scanned a code, double-check it — or jump
          straight to the join screen.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-2">
          <a href="/join" className="term-button-primary">
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
            <span>Join_Session</span>
          </a>
          <a href="/" className="term-button-secondary">
            <span className="material-symbols-outlined text-[18px]">home</span>
            <span>Landing_Page</span>
          </a>
        </div>
      </div>
    </div>
  );
}