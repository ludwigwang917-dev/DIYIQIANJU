import assert from "node:assert/strict";
import test from "node:test";
import { createDeck, evaluateHand } from "../lib/games/niuniu/kernel.ts";

const card = (suit, rank) => ({ id: `${suit}-${rank}`, suit, rank });

test("creates a unique 54-card deck", () => {
  const deck = createDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map((item) => item.id)).size, 54);
});

test("finds the best valid cattle split", () => {
  const hand = evaluateHand([
    card("spade", "A"),
    card("heart", "2"),
    card("club", "7"),
    card("diamond", "K"),
    card("heart", "Q"),
  ]);
  assert.equal(hand.cattle, 10);
  assert.equal(hand.label, "牛牛");
  assert.equal(hand.multiplier, 5);
});

test("counts a front-three sum of 30 as a bull", () => {
  const hand = evaluateHand([
    card("spade", "10"),
    card("heart", "J"),
    card("club", "Q"),
    card("diamond", "2"),
    card("heart", "3"),
  ]);
  assert.equal(hand.cattle, 5);
  assert.equal(hand.label, "牛五");
});

test("Q J 8 K 9 is 牛七 via Q+J+K = 30", () => {
  const hand = evaluateHand([
    card("club", "Q"),
    card("club", "J"),
    card("spade", "8"),
    card("spade", "K"),
    card("spade", "9"),
  ]);
  assert.equal(hand.cattle, 7);
  assert.equal(hand.label, "牛七");
  assert.equal(hand.multiplier, 2);
});

test("no three cards summing to a multiple of 10 is 无牛", () => {
  const hand = evaluateHand([
    card("spade", "K"),
    card("heart", "Q"),
    card("spade", "A"),
    card("heart", "2"),
    card("club", "4"),
  ]);
  assert.equal(hand.cattle, 0);
});
