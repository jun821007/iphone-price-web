/**
 * 同行行情 → 我的賣價（台幣）。
 * 二手行情頁與本月二手銷售頁都呼叫這裡，避免兩套門檻。
 * 無行情（null / 非數字）回 null，呼叫端維持空白或 —。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function mySellPrice(marketPrice) {
    if (marketPrice == null) return null;
    if (typeof marketPrice === "string" && marketPrice.trim() === "") return null;
    const n = Number(marketPrice);
    if (!Number.isFinite(n)) return null;
    if (n < 15000) return n + 1500;
    if (n < 25000) return n + 2000;
    return n + 2500;
  }

  /**
   * 畫面上的同行行情區間。已剔除、以及非賣單（買單／徵收）不進基準價。
   * @returns {{ min: number, max: number, count: number } | null}
   */
  function peerMarketBounds(ticks) {
    const prices = [];
    for (const tick of ticks || []) {
      if (!tick || tick.excluded) continue;
      if (tick.trade_side && tick.trade_side !== "sell") continue;
      if (tick.price == null || tick.price === "") continue;
      const n = Number(tick.price);
      if (!Number.isFinite(n)) continue;
      prices.push(n);
    }
    if (!prices.length) return null;
    return { min: Math.min(...prices), max: Math.max(...prices), count: prices.length };
  }

  /** 同一批 ticks 的同行區間與我的賣價。無行情回 null。 */
  function mySellFromTicks(ticks) {
    const peer = peerMarketBounds(ticks);
    if (!peer) return null;
    return {
      peerMin: peer.min,
      peerMax: peer.max,
      count: peer.count,
      sellMin: mySellPrice(peer.min),
      sellMax: mySellPrice(peer.max),
    };
  }

  return { mySellPrice, peerMarketBounds, mySellFromTicks };
});
