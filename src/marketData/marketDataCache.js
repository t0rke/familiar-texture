import { readCachedCandles, saveCandles } from "./candleStore.js";

export async function getCachedCandles(input) {
  return readCachedCandles(input);
}

export async function putCachedCandles(candles) {
  return saveCandles(candles);
}
