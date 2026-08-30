import { Link } from 'react-router-dom';

// Public landing page — Judge OS terminal aesthetic.
// Modeled on the Stitch "Luminous Slate: Technical Landing Page" structure,
// re-skinned to match the Judge OS control-room aesthetic (mono branding,
// bracket labels, dot-grid backdrop, emerald CTAs).
export default function LandingPage() {
  return (
    <div className="dot-grid min-h-screen text-on-surface font-body">
      {/* Top status strip */}
      <header className="border-b border-border bg-surface/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1280px] mx-auto h-14 px-4 md:px-6 flex items-center justify-between">
          <span className="font-mono text-label uppercase tracking-[0.15em]">
            Judge_OS<span className="text-muted">:v1.0</span>
          </span>
          <div className="hidden md:flex items-center gap-2 font-mono text-micro uppercase tracking-[0.18em] text-muted">
            <span className="w-1.5 h-1.5 bg-primary pulse-emerald rounded-full inline-block" />
            <span>System_Online</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/join" className="term-button-secondary !text-[0.6875rem] !px-3 !py-1.5">
              Join_Session
            </Link>
            <a href="/api/auth/google/start" className="term-button-primary !text-[0.6875rem] !px-3 !py-1.5">
              Login
            </a>
          </div>
        </div>
        <div className="h-px scan-sweep" />
      </header>

      {/* Hero */}
      <section className="max-w-[1280px] mx-auto px-4 md:px-6 pt-16 pb-20 grid lg:grid-cols-12 gap-gutter items-center">
        <div className="lg:col-span-7">
          <div className="flex items-center gap-3 mb-6">
            <span className="status-pill status-pill-live">
              <span className="w-1.5 h-1.5 bg-primary rounded-full pulse-emerald inline-block" />
              Live_Executor
            </span>
            <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
              v2.0.4 - Stable
            </span>
          </div>
          <h1 className="font-mono text-display md:text-[2.5rem] uppercase tracking-[-0.02em] text-on-surface leading-[1.1]">
            Precision Evaluation
            <br />
            for Every Presentation.
          </h1>
          <p className="mt-6 font-body text-body text-on-surface-variant max-w-2xl">
            The Judge_OS protocol streams live audience judgment into your slide runtime. Pair every
            decision point with a vector score, watch the room reconcile in real time, and ship the
            post-mortem as structured JSON before you leave the room.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/api/auth/google/start" className="term-button-primary">
              <span className="material-symbols-outlined text-[18px]">login</span>
              <span>Login</span>
            </a>
            <Link to="/join" className="term-button-secondary">
              <span className="material-symbols-outlined text-[18px]">cast</span>
              <span>Join_Session</span>
            </Link>
          </div>

          {/* Inline stats row */}
          <div className="mt-10 grid grid-cols-3 max-w-xl gap-px bg-border border border-border">
            {[
              { label: 'Sync.Latency', value: '12ms' },
              { label: 'Uptime', value: '99.998%' },
              { label: 'Avg.Nodes', value: '04:08s' },
            ].map((stat) => (
              <div key={stat.label} className="bg-surface px-4 py-3">
                <div className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                  {stat.label}
                </div>
                <div className="font-mono text-display-sm text-on-surface mt-1">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right terminal card */}
        <div className="lg:col-span-5">
          <div className="term-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">
                Console_IO
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-danger rounded-full" />
                <span className="w-2 h-2 bg-warning rounded-full" />
                <span className="w-2 h-2 bg-primary rounded-full" />
              </span>
            </div>
            <pre className="px-4 py-4 font-mono text-micro uppercase tracking-[0.05em] text-on-surface leading-[1.6] overflow-x-auto whitespace-pre">
{`> judge_os.boot
[OK] handshake :: edge.cdn
[OK] realtime_ws :: wss://feedback/session
[OK] durable_obj :: presentation_session
[OK] d1_schema :: 6 tables online
> judge_os.mode --live
> awaiting_presenter`}
            </pre>
            <div className="border-t border-border px-4 py-2 flex items-center gap-2 font-mono text-micro uppercase tracking-[0.18em] text-primary">
              <span>{'>'}</span>
              <span className="cursor-blink">_</span>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="max-w-[1280px] mx-auto px-4 md:px-6 pb-20">
        <div className="flex items-end justify-between border-b border-border pb-4 mb-6">
          <div>
            <div className="term-label">[01] Core_Capabilities</div>
            <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em] text-on-surface mt-1">
              What runs under the hood.
            </h2>
          </div>
          <span className="hidden md:block font-mono text-micro uppercase tracking-[0.18em] text-muted">
            Sys.Health: Optimal &nbsp;·&nbsp; Latency: 12ms &nbsp;·&nbsp; Sync.Time: {new Date().toISOString().slice(11, 19)}Z
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
          {[
            {
              idx: '01',
              tag: 'Protocol.Ws',
              title: 'Realtime WebSocket',
              desc: 'Session state streams over a Durable Object so every connected participant resolves the active slide in under 20ms.',
            },
            {
              idx: '02',
              tag: 'Vector.Scoring',
              title: 'Per-Slide Scoring',
              desc: 'Configure boolean, multiple choice, or open-text feedback per slide. Default questions layer interest + 0–10 ratings across all configured slides.',
            },
            {
              idx: '03',
              tag: 'Export.Pipeline',
              title: 'Structured Export',
              desc: 'Pull the full session JSON or CSV. Slide order, questions, answers, and timestamps are preserved for downstream analysis.',
            },
            {
              idx: '04',
              tag: 'Ai.Activation',
              title: 'Algorithmic Objectivity',
              desc: 'Compute audience compliance in real time and surface a 0–100 aggregate score that mirrors how your slide landed in the room.',
            },
            {
              idx: '05',
              tag: 'Node.Activity',
              title: 'Live Participant Log',
              desc: 'A customisable activity stream tracks every join and response so the host always knows the room is engaged.',
            },
            {
              idx: '06',
              tag: 'Compliance',
              title: 'Resubmission Control',
              desc: 'Lock responses or allow edits per slide. Submit / submit-again rules enforced server-side so participants cannot game the result.',
            },
          ].map((f) => (
            <div key={f.idx} className="bg-surface p-6 hover:bg-surface-1 transition">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-muted">{f.idx}</span>
                <span className="font-mono text-micro uppercase tracking-[0.18em] text-primary">[{f.tag}]</span>
              </div>
              <h3 className="font-mono text-h2 text-on-surface mb-2">{f.title}</h3>
              <p className="font-body text-body text-on-surface-variant">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer status bar */}
      <footer className="border-t border-border bg-surface">
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 h-10 flex items-center justify-between font-mono text-micro uppercase tracking-[0.18em] text-muted">
          <span>Judge_OS — Internal Feedback System</span>
          <span className="hidden md:inline">Fbk.Cert.Verified</span>
        </div>
      </footer>
    </div>
  );
}
