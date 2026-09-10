import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COST, DAMAGE, newFighter, resolveRound, matchWinner, elo, chooseMove } from './kernel.mjs';

const F = () => ({ hp: 100, budget: 10 });

test('costs and damages are pinned', () => {
  assert.deepEqual({ ...COST }, { strike: 2, guard: 1, special: 5 });
  assert.deepEqual({ ...DAMAGE }, { strike: 10, special: 25 });
});

test('newFighter: valid and total', () => {
  assert.deepEqual(newFighter(100, 10), { ok: true, fighter: { hp: 100, budget: 10 } });
  assert.equal(newFighter(0, 10).ok, false);       // hp positive
  assert.equal(newFighter(-1, 10).ok, false);
  assert.equal(newFighter(1.5, 10).ok, false);
  assert.equal(newFighter(100, -1).ok, false);     // budget non-negative
  assert.equal(newFighter(100, 0).ok, true);       // budget 0 valid (kills < 0 → <= 0)
});

test('strike vs strike: both land a trade', () => {
  const r = resolveRound(F(), F(), { type: 'strike' }, { type: 'strike' });
  assert.equal(r.a.hp, 90);
  assert.equal(r.b.hp, 90);
  assert.equal(r.dealtByA, DAMAGE.strike);
  assert.equal(r.a.budget, 8);   // spent strike cost 2
});

test('guard blocks a strike — the guarder takes nothing', () => {
  const r = resolveRound(F(), F(), { type: 'strike' }, { type: 'guard' });
  assert.equal(r.b.hp, 100);     // b guarded a's strike
  assert.equal(r.a.hp, 100);     // b's guard deals nothing
  assert.equal(r.dealtByA, 0);
});

test('a PROVEN special lands big and ignores guard — the moves are code', () => {
  const r = resolveRound(F(), F(), { type: 'special', proven: true }, { type: 'guard' });
  assert.equal(r.b.hp, 100 - DAMAGE.special);   // 75 — guard does not block a landed special
  assert.equal(r.dealtByA, 25);
  assert.equal(r.log.a, 'special(landed)');
});

test('an UNPROVEN special whiffs — code that failed its gate does not connect', () => {
  const r = resolveRound(F(), F(), { type: 'special', proven: false }, { type: 'guard' });
  assert.equal(r.b.hp, 100);         // whiffed
  assert.equal(r.dealtByA, 0);
  assert.equal(r.a.budget, 5);       // but it still SPENT the special's budget (cost 5)
  assert.equal(r.log.a, 'special(whiff)');
});

test('strike vs proven special: interrupt trade — both land', () => {
  const r = resolveRound(F(), F(), { type: 'strike' }, { type: 'special', proven: true });
  assert.equal(r.b.hp, 90);          // a's strike lands
  assert.equal(r.a.hp, 75);          // b's proven special lands
});

test('strike vs unproven special: only the strike lands', () => {
  const r = resolveRound(F(), F(), { type: 'strike' }, { type: 'special', proven: false });
  assert.equal(r.b.hp, 90);          // a's strike lands
  assert.equal(r.a.hp, 100);         // b's special whiffed
});

test('THE LEVELLER INVARIANT: outcome is blind to raw power — same moves, same result', () => {
  // attach wildly different "model" metadata; the resolver must ignore it entirely
  const small = { hp: 100, budget: 10, model: 'qwen-4b', params: 4e9 };
  const huge = { hp: 100, budget: 10, model: 'nexus-70b', params: 7e10 };
  const r1 = resolveRound(small, huge, { type: 'strike' }, { type: 'strike' });
  const r2 = resolveRound(huge, small, { type: 'strike' }, { type: 'strike' });
  assert.equal(r1.a.hp, r2.a.hp);           // identical — power never entered the maths
  assert.equal(r1.b.hp, r2.b.hp);
  assert.equal(r1.dealtByA, r2.dealtByA);
  // and the ONLY way the 70B could win is a better move: proven special beats a bare strike
  const won = resolveRound(huge, small, { type: 'special', proven: true }, { type: 'strike' });
  assert.equal(won.b.hp, 75);               // strategy (a landed special), not size, dealt more
});

test('unaffordable move FIZZLES — no cost, no effect, budget never negative', () => {
  const broke = { hp: 100, budget: 1 };     // cannot afford a special (cost 5) or a strike (cost 2)
  const r = resolveRound(broke, F(), { type: 'special', proven: true }, { type: 'guard' });
  assert.equal(r.dealtByA, 0);              // fizzled
  assert.equal(r.a.budget, 1);              // spent nothing
  assert.ok(r.a.budget >= 0);
});

test('resolveRound: total on garbage', () => {
  assert.equal(resolveRound(null, F(), { type: 'strike' }, { type: 'guard' }).ok, false);
  assert.equal(resolveRound(F(), F(), { type: 'kick' }, { type: 'guard' }).ok, false);
  assert.equal(resolveRound(F(), F(), { type: 'special' }, { type: 'guard' }).ok, false); // special needs proven
  assert.equal(resolveRound(F(), F(), 'x', { type: 'guard' }).ok, false);
});

test('matchWinner: KO, higher-hp, draw', () => {
  assert.equal(matchWinner(0, 50).winner, 'b');
  assert.equal(matchWinner(50, 0).winner, 'a');
  assert.equal(matchWinner(0, 0).winner, 'draw');
  assert.equal(matchWinner(60, 40).winner, 'a');
  assert.equal(matchWinner(40, 60).winner, 'b');
  assert.equal(matchWinner(50, 50).winner, 'draw');
  assert.equal(matchWinner(-1, 5).ok, false);
});

test('elo: a win raises the winner, an upset moves more, symmetric', () => {
  const evenWin = elo(1500, 1500, 1);
  assert.equal(evenWin.expectedA, 0.5);
  assert.equal(evenWin.a, 1516);   // 1500 + 32*0.5
  assert.equal(evenWin.b, 1484);
  // an underdog winning gains more than a favourite winning
  const upset = elo(1400, 1600, 1);
  const expected = elo(1600, 1400, 1);
  assert.ok(upset.delta > expected.delta);
  // a draw between equals moves nothing
  assert.equal(elo(1500, 1500, 0.5).a, 1500);
});

test('elo: total on garbage, scoreA constrained, k positive', () => {
  assert.equal(elo('x', 1500, 1).ok, false);
  assert.equal(elo(1500, 1500, 0.7).ok, false);   // scoreA must be 0/0.5/1
  assert.equal(elo(1500, 1500, 1, 0).ok, false);  // k positive
  assert.equal(elo(1500, 1500, 1, -5).ok, false);
  assert.equal(elo(1500, 1500, 0).ok, true);      // a loss is a valid score
});

test('afford edge: a fighter with budget EXACTLY the move cost can perform it (kills >= → >)', () => {
  const exact = { hp: 100, budget: COST.special };   // budget == 5 == special cost
  const r = resolveRound(exact, { hp: 100, budget: 10 }, { type: 'special', proven: true }, { type: 'guard' });
  assert.equal(r.dealtByA, DAMAGE.special);          // afforded and landed
  assert.equal(r.a.budget, 0);                        // spent exactly to zero
});

test('log labels are exact for non-specials (kills === special → !==)', () => {
  const r = resolveRound({ hp: 100, budget: 10 }, { hp: 100, budget: 10 }, { type: 'strike' }, { type: 'guard' });
  assert.equal(r.log.a, 'strike');     // NOT 'strike(whiff)' — the special-suffix only attaches to specials
  assert.equal(r.log.b, 'guard');
});

test('readMove guards each fire alone (null throws through a merged guard — caught here)', () => {
  const F2 = { hp: 100, budget: 10 };
  assert.equal(resolveRound(F2, F2, null, { type: 'guard' }).ok, false);        // null move
  assert.equal(resolveRound(F2, F2, [], { type: 'guard' }).ok, false);          // array move
  assert.equal(resolveRound(F2, F2, 'strike', { type: 'guard' }).ok, false);    // string move
  assert.equal(resolveRound(F2, F2, 42, { type: 'guard' }).ok, false);          // number move
});

test('chooseMove: the House agent plays sensibly and deterministically', () => {
  // budget + a proof → a proven special (best value)
  const s = chooseMove({ selfBudget: 10, hasProof: true }, 42);
  assert.deepEqual(s.move, { type: 'special', proven: true });
  // budget but no proof → strike or guard, never a special it cannot back
  const ns = chooseMove({ selfBudget: 10, hasProof: false }, 42);
  assert.ok(ns.move.type === 'strike' || ns.move.type === 'guard');
  assert.notEqual(ns.move.type, 'special');
  // too poor to strike → guard (regen)
  assert.equal(chooseMove({ selfBudget: 1, hasProof: true }, 42).move.type, 'guard');
  // deterministic: same view+seed → same move
  assert.deepEqual(chooseMove({ selfBudget: 10, hasProof: false }, 7).move, chooseMove({ selfBudget: 10, hasProof: false }, 7).move);
  // budget exactly special cost + proof → special (kills selfBudget >= COST.special → >)
  assert.equal(chooseMove({ selfBudget: 5, hasProof: true }, 42).move.type, 'special');
  // budget exactly strike cost, no proof → never a special, only strike or guard (afford edge)
  assert.notEqual(chooseMove({ selfBudget: 2, hasProof: false }, 3).move.type, 'special');
  // budget just below strike cost → guard only (cannot strike)
  assert.equal(chooseMove({ selfBudget: 1, hasProof: false }, 3).move.type, 'guard');
  // budget EXACTLY strike cost (2) can strike (kills selfBudget >= COST.strike → >)
  assert.equal(chooseMove({ selfBudget: 2, hasProof: false }, 2).move.type, 'strike');
  // the strike/guard jitter is real — seed 2 strikes, seed 1 guards (kills next%4 !== 0 → === 0)
  assert.equal(chooseMove({ selfBudget: 10, hasProof: false }, 2).move.type, 'strike');
  assert.equal(chooseMove({ selfBudget: 10, hasProof: false }, 1).move.type, 'guard');
  // the LCG constant is pinned (kills + 1013904223 → -)
  assert.equal(chooseMove({ selfBudget: 5, hasProof: true }, 42).seed, 1083814273);
});

test('chooseMove: total on garbage', () => {
  assert.equal(chooseMove(null, 1).ok, false);
  assert.equal(chooseMove([], 1).ok, false);
  assert.equal(chooseMove({ selfBudget: 1.5, hasProof: true }, 1).ok, false);
  assert.equal(chooseMove({ selfBudget: -1, hasProof: true }, 1).ok, false);
  assert.equal(chooseMove({ selfBudget: 5, hasProof: 'yes' }, 1).ok, false);
  assert.equal(chooseMove({ selfBudget: 5, hasProof: true }, -1).ok, false);
  assert.equal(chooseMove({ selfBudget: 5, hasProof: true }, 1.5).ok, false);
  assert.equal(chooseMove({ selfBudget: 0, hasProof: true }, 0).ok, true);   // budget 0 valid (kills < 0 → <= 0); seed 0 valid
});

test('a full House-vs-House match reaches a KO with no human input', () => {
  let a = { hp: 100, budget: 10 }, b = { hp: 100, budget: 10 };
  let sa = 11, sb = 99, rounds = 0, over = false;
  while (!over && rounds < 200) {
    const ma = chooseMove({ selfBudget: a.budget, hasProof: a.budget >= COST.special }, sa); sa = ma.seed;
    const mb = chooseMove({ selfBudget: b.budget, hasProof: b.budget >= COST.special }, sb); sb = mb.seed;
    const r = resolveRound(a, b, ma.move, mb.move);
    assert.equal(r.ok, true);
    a = { hp: r.a.hp, budget: Math.min(10, r.a.budget + 3) };
    b = { hp: r.b.hp, budget: Math.min(10, r.b.budget + 3) };
    rounds++;
    if (a.hp === 0 || b.hp === 0) over = true;
  }
  assert.equal(over, true, 'the match must terminate, not stall');   // proves the game actually plays to completion
  assert.ok(rounds < 200, 'it must KO well before the safety cap: ' + rounds);
  const w = matchWinner(a.hp, b.hp);
  assert.ok(['a', 'b', 'draw'].includes(w.winner));   // a double-KO draw is a valid ending; the point is it CONCLUDED
});
