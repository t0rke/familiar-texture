import crypto from "crypto";

export async function callRobinhoodTool(client, name, args = {}) {
  return client.callTool({
    name,
    arguments: args,
  });
}

export async function getAccounts(client) {
  return callRobinhoodTool(client, "get_accounts", {});
}

export async function getPortfolio(client, account_number) {
  return callRobinhoodTool(client, "get_portfolio", {
    account_number,
  });
}

export async function getEquityTradability(client, account_number, symbols) {
  return callRobinhoodTool(client, "get_equity_tradability", {
    account_number,
    symbols,
  });
}

export async function reviewEquityOrder(client, order) {
  return callRobinhoodTool(client, "review_equity_order", order);
}

export async function placeEquityOrder(client, order) {
  return callRobinhoodTool(client, "place_equity_order", {
    ...order,
    ref_id: order.ref_id ?? crypto.randomUUID(),
  });
}