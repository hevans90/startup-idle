import { describe, test, expect } from 'bun:test';
import { applyEffectiveSatisfaction } from './modifiers';

describe('applyEffectiveSatisfaction', () => {
  test('neutralized=true, raw=50, positiveMult=2.0 -> 0 (neutralization wins)', () => {
    expect(applyEffectiveSatisfaction(50, { satisfactionNeutralized: true, satisfactionPositiveMult: 2.0 })).toBe(0);
  });

  test('neutralized=true, raw=-100, positiveMult=1.0 -> 0 (neutralizes negatives too)', () => {
    expect(applyEffectiveSatisfaction(-100, { satisfactionNeutralized: true, satisfactionPositiveMult: 1.0 })).toBe(0);
  });

  test('neutralized=false, positiveMult=1.0, raw=75 -> 75 (identity)', () => {
    expect(applyEffectiveSatisfaction(75, { satisfactionNeutralized: false, satisfactionPositiveMult: 1.0 })).toBe(75);
  });

  test('neutralized=false, positiveMult=0.5, raw=80 -> 40 (Enshittify scales positive)', () => {
    expect(applyEffectiveSatisfaction(80, { satisfactionNeutralized: false, satisfactionPositiveMult: 0.5 })).toBe(40);
  });

  test('neutralized=false, positiveMult=0.5, raw=-30 -> -30 (negative not scaled)', () => {
    expect(applyEffectiveSatisfaction(-30, { satisfactionNeutralized: false, satisfactionPositiveMult: 0.5 })).toBe(-30);
  });

  test('neutralized=false, positiveMult=2.0, raw=0 -> 0 (zero is not >0, not scaled)', () => {
    expect(applyEffectiveSatisfaction(0, { satisfactionNeutralized: false, satisfactionPositiveMult: 2.0 })).toBe(0);
  });
});
