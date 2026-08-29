// Static dot-grid background used by Judge OS screens.
// Honors prefers-reduced-motion by skipping the scan-line overlay.
export default function DotGridBackground({
  children,
  tight = false,
}: {
  children?: React.ReactNode;
  tight?: boolean;
}) {
  return (
    <div className={tight ? 'dot-grid-tight' : 'dot-grid'} style={{ minHeight: '100%' }}>
      {children}
    </div>
  );
}
