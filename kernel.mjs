// didy-arena — the witnessed fight resolver. The heart of the agent battle arena.
//
// A fighting game on the surface (health bars, rounds, specials). Underneath: a reasoning
// benchmark between two AI agents, at a FIXED compute budget, decided by CODE. Two laws make
// it real rather than a toy:
//
//   THE LEVELLER — the resolver is BLIND to raw power. It reads only the moves and the shared
//   fighter state (equal HP, equal budget at start). A 70B beats a 14B only by choosing better
//   moves, never by being bigger. This is "from raw power to intelligence" as a code invariant:
//   the same move sequence produces the same outcome no matter which model chose it.
//
//   THE MOVES ARE CODE — a `special` is a code move that only LANDS if it passed its gate
//   (proven === true). An unproven special whiffs and wastes its budget. A move must survive
//   the witness to connect — the estate's crown jewel (proof-of-play) as combat.
//
// The fight log this produces is the serious payload: a deterministic, reproducible,
// model-agnostic record of which agent out-reasoned which at equal compute. Pure and total.

const isInt = (v) => Number.isInteger(v);

const MOVES = Object.freeze(['strike', 'guard', 'special']);
export const COST = Object.freeze({ strike: 2, guard: 1, special: 5 });
export const DAMAGE = Object.freeze({ strike: 10, special: 25 });

// A fighter: { hp, budget }. Equal at the bell — that equality IS the level playing field.
export function newFighter(hp, budget) {
  if (!isInt(hp)) return { ok: false, why: 'hp must be an integer' };
  if (hp <= 0) return { ok: false, why: 'hp must be positive' };
  if (!isInt(budget)) return { ok: false, why: 'budget must be an integer' };
  if (budget < 0) return { ok: false, why: 'budget must be non-negative' };
  return { ok: true, fighter: { hp, budget } };
}

// Validate + normalise a move. A move is { type, proven? }. `proven` matters only for a
// special (did its code-move pass the gate); it defaults to false — an unproven special whiffs.
function readMove(m) {
  if (typeof m !== 'object') return { ok: false, why: 'a move is { type, proven? }' };
  if (m === null) return { ok: false, why: 'a move is { type, proven? }' };
  if (Array.isArray(m)) return { ok: false, why: 'a move is { type, proven? }, not an array' };
  if (!MOVES.includes(m.type)) return { ok: false, why: 'move.type must be strike|guard|special' };
  if (m.type === 'special' && typeof m.proven !== 'boolean') return { ok: false, why: 'a special move needs proven:boolean (did its code pass the gate)' };
  return { ok: true, type: m.type, proven: m.type === 'special' ? m.proven : false };
}

// Can the fighter afford the move? If not, the move FIZZLES — it becomes a no-op that still
// costs nothing (you simply could not perform it), so budget can never go negative.
function afford(budget, type) {
  return budget >= COST[type];
}

/**
 * resolveRound(a, b, moveA, moveB) — one deterministic exchange. a,b are { hp, budget }.
 * Returns the new states, the damage each dealt, and a log. The interaction:
 *   - a move you cannot afford FIZZLES (no cost, no effect).
 *   - guard fully blocks an opponent's strike; guard does NOT block a landed special.
 *   - strike vs strike: both land (a trade).
 *   - special: lands (full damage, ignores guard) ONLY if proven; unproven → whiffs (spends budget, no damage).
 *   - strike vs special: if the special is proven it lands; the strike also lands (interrupt trade).
 *     If the special is unproven, it whiffs and only the strike lands.
 * Damage is dealt simultaneously from the pre-round state, so the round is order-independent.
 */
export function resolveRound(a, b, moveA, moveB) {
  const fa = newFighter(a && a.hp, a && a.budget);
  if (!fa.ok) return { ok: false, why: 'fighter a: ' + fa.why };
  const fb = newFighter(b && b.hp, b && b.budget);
  if (!fb.ok) return { ok: false, why: 'fighter b: ' + fb.why };
  const ma = readMove(moveA);
  if (!ma.ok) return { ok: false, why: 'move a: ' + ma.why };
  const mb = readMove(moveB);
  if (!mb.ok) return { ok: false, why: 'move b: ' + mb.why };

  // resolve affordability → an unaffordable move fizzles to a no-op
  const act = (m, budget) => {
    if (!afford(budget, m.type)) return { type: 'fizzle', proven: false, spent: 0 };
    return { type: m.type, proven: m.proven, spent: COST[m.type] };
  };
  const actA = act(ma, a.budget);
  const actB = act(mb, b.budget);

  // does a fighter's attack LAND on the opponent, given the opponent's action?
  const lands = (att, def) => {
    if (att.type === 'strike') return def.type === 'guard' ? 0 : DAMAGE.strike;   // guard blocks a strike
    if (att.type === 'special') return att.proven ? DAMAGE.special : 0;           // special lands only if proven; ignores guard
    return 0;                                                                      // guard / fizzle deal nothing
  };
  const dmgToB = lands(actA, actB);
  const dmgToA = lands(actB, actA);

  const na = { hp: Math.max(0, a.hp - dmgToA), budget: a.budget - actA.spent };
  const nb = { hp: Math.max(0, b.hp - dmgToB), budget: b.budget - actB.spent };
  return {
    ok: true,
    a: na, b: nb,
    dealtByA: dmgToB, dealtByB: dmgToA,
    log: { a: actA.type + (actA.type === 'special' ? (actA.proven ? '(landed)' : '(whiff)') : ''), b: actB.type + (actB.type === 'special' ? (actB.proven ? '(landed)' : '(whiff)') : '') },
  };
}

// The match verdict from two HP totals.
export function matchWinner(hpA, hpB) {
  if (!isInt(hpA)) return { ok: false, why: 'hpA must be an integer' };
  if (hpA < 0) return { ok: false, why: 'hpA cannot be negative' };
  if (!isInt(hpB)) return { ok: false, why: 'hpB must be an integer' };
  if (hpB < 0) return { ok: false, why: 'hpB cannot be negative' };
  if (hpA === 0 && hpB === 0) return { ok: true, winner: 'draw' };
  if (hpA === 0) return { ok: true, winner: 'b' };
  if (hpB === 0) return { ok: true, winner: 'a' };
  if (hpA > hpB) return { ok: true, winner: 'a' };
  if (hpB > hpA) return { ok: true, winner: 'b' };
  return { ok: true, winner: 'draw' };
}

// ELO update for the leaderboard. scoreA in {1 win, 0.5 draw, 0 loss}. K default 32.
export function elo(ratingA, ratingB, scoreA, k) {
  if (!Number.isFinite(ratingA)) return { ok: false, why: 'ratingA must be finite' };
  if (!Number.isFinite(ratingB)) return { ok: false, why: 'ratingB must be finite' };
  if (![0, 0.5, 1].includes(scoreA)) return { ok: false, why: 'scoreA must be 1 (win), 0.5 (draw) or 0 (loss)' };
  const K = k === undefined ? 32 : k;
  if (!Number.isFinite(K)) return { ok: false, why: 'k must be finite' };
  if (!(K > 0)) return { ok: false, why: 'k must be positive' };
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const deltaA = K * (scoreA - expectedA);
  return {
    ok: true,
    a: Math.round(ratingA + deltaA),
    b: Math.round(ratingB - deltaA),
    expectedA: Math.round(expectedA * 1000) / 1000,
    delta: Math.round(deltaA * 100) / 100,
  };
}
