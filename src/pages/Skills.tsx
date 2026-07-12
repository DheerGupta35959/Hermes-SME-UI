import { skills, type Skill } from "../brain";

function Badges({ s }: { s: Skill }) {
  return (
    <div className="skill-badges">
      {s.schedule && (
        <span className="tag badge-schedule" title={`Schedule: ${s.schedule.label}`}>
          🕐 {s.schedule.label}
        </span>
      )}
      {s.chain && (
        <span className="tag badge-chain" title={`Chains to: ${s.chain.nextWorker}`}>
          → {s.chain.nextWorker}
        </span>
      )}
      {/* Show incoming chain — workers that chain to this one */}
      {skills.some(
        (x) => x.chain?.nextWorker === s.name && x.name !== s.name
      ) && (
        <span className="tag badge-chain-in" title="Receives chained work">
          ← chained
        </span>
      )}
      {s.abTest && (
        <span className="tag badge-ab" title={`A/B test: ${s.abTest.splitB}% variant B`}>
          A/B test
        </span>
      )}
    </div>
  );
}

export function Skills() {
  return (
    <div className="page">
      <div className="page-head">
        <h2>Workers</h2>
        <p>
          The jobs your assistant runs for you, around the clock. Every worker checks your
          rules before acting, and they get better the longer they work for you.
        </p>
      </div>
      <div className="skill-grid">
        {skills.map((s) => (
          <div key={s.name} className="skill">
            <div className="skill-top">
              <code className="skill-name">{s.name}</code>
              <span className={`arm ${s.arm}`}>
                {s.arm === "reactive" ? "responds" : s.arm === "proactive" ? "takes initiative" : "always on"}
              </span>
            </div>
            <div className="skill-purpose">{s.purpose}</div>
            <Badges s={s} />
            <div className="skill-meta">
              {s.runs} times this month · last {s.lastRun}
              {s.schedule?.nextRun && <span> · next {s.schedule.nextRun}</span>}
              {s.abTest && (
                <span>
                  {" · "}
                  {s.abTest.variants[0].name}: {s.abTest.variants[0].successRate}% ·{" "}
                  {s.abTest.variants[1].name}: {s.abTest.variants[1].successRate}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
