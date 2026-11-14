// An Ionic column that holds content: abacus slab, capital with two scroll
// volutes (drawn like the columns in the key art), fluted shaft, stepped base.

function Volute() {
  // Semicircle spiral, unwinding from the center outwards.
  return (
    <svg className="volute" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18.5" />
      <path d="M20 20a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0a7.5 7.5 0 0 1 15 0a9 9 0 0 1-18 0" />
    </svg>
  );
}

export default function Pillar({ title, children }) {
  return (
    <article className="pillar">
      <div className="pillar-abacus" />
      <div className="pillar-capital">
        <Volute />
        <div className="pillar-echinus" />
        <Volute />
      </div>
      <div className="pillar-shaft">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
      <div className="pillar-base" />
      <div className="pillar-plinth" />
    </article>
  );
}
