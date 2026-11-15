// A faint navigator's star chart behind the top of the page. These are the stars Odysseus steers
// by when he leaves Calypso's island (Odyssey, Book 5): "the Pleiades, late-setting Boötes, and
// the Bear, which men also call the Wain." The lines draw in once, then the stars twinkle slowly.
// Purely decorative: no pointer events, hidden from screen readers, still under reduced motion.

// The Bear (the Big Dipper): handle → bowl, then close the bowl.
const BEAR = [
  [470, 40], [510, 28], [544, 36], [576, 52], [582, 86], [636, 92], [642, 56],
];
const BEAR_LINES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]];

// Boötes, the herdsman: a kite with Arcturus, the bright star, at its tail.
const BOOTES = [
  [758, 104], [778, 74], [780, 44], [760, 20], [740, 44], [744, 74], [732, 118],
];
const BOOTES_LINES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6]];

// The Pleiades: a tight cluster, no lines.
const PLEIADES = [
  [884, 96], [894, 90], [904, 98], [889, 104], [901, 107], [912, 91], [895, 113],
];

// Scattered background stars from a fixed seed, so server and client render the same thing.
function seededStars(count) {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, () => ({
    x: Math.round(rand() * 1000),
    y: Math.round(rand() * 150),
    r: 0.6 + rand() * 0.9,
    delay: (rand() * 8).toFixed(2),
    duration: (5 + rand() * 6).toFixed(2),
  }));
}
const FIELD = seededStars(46);

function Constellation({ stars, lines, name, bright = [] }) {
  return (
    <g className={`constellation constellation-${name}`}>
      {lines.map(([a, b], i) => (
        <line
          key={i}
          className="star-line"
          x1={stars[a][0]}
          y1={stars[a][1]}
          x2={stars[b][0]}
          y2={stars[b][1]}
          style={{ animationDelay: `${0.4 + i * 0.18}s` }}
        />
      ))}
      {stars.map(([x, y], i) => (
        <circle
          key={i}
          className={`star ${bright.includes(i) ? 'star-bright' : ''}`}
          cx={x}
          cy={y}
          r={bright.includes(i) ? 3.2 : 2.2}
          style={{ animationDelay: `${(i * 1.3) % 7}s` }}
        />
      ))}
    </g>
  );
}

export default function StarChart() {
  return (
    <svg className="starchart" viewBox="0 0 1000 170" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
      {FIELD.map((s, i) => (
        <circle
          key={i}
          className="star star-faint"
          cx={s.x}
          cy={s.y}
          r={s.r}
          style={{ animationDelay: `${s.delay}s`, animationDuration: `${s.duration}s` }}
        />
      ))}
      <Constellation name="bear" stars={BEAR} lines={BEAR_LINES} />
      <Constellation name="bootes" stars={BOOTES} lines={BOOTES_LINES} bright={[0]} />
      <g className="constellation constellation-pleiades">
        {PLEIADES.map(([x, y], i) => (
          <circle key={i} className="star" cx={x} cy={y} r={1.8} style={{ animationDelay: `${i * 0.9}s` }} />
        ))}
      </g>
    </svg>
  );
}
