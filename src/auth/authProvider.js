import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import open from "open";

const TOKEN_DIR = path.join(os.homedir(), ".familiar-texture");

function ensureDir() {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  }
}

function filePath(name) {
  return path.join(TOKEN_DIR, `${name}.json`);
}

function readJson(name) {
  ensureDir();

  const target = filePath(name);

  if (!fs.existsSync(target)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function writeJson(name, value) {
  ensureDir();

  fs.writeFileSync(filePath(name), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
}

function deleteJson(name) {
  const target = filePath(name);

  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

export class RobinhoodOAuthProvider {
  constructor({ redirectUrl }) {
    this._redirectUrl = redirectUrl;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata() {
    return {
      client_name: "familiar-texture",
      redirect_uris: [String(this._redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "internal",
    };
  }

  async state() {
    const state = crypto.randomBytes(24).toString("base64url");
    writeJson("oauth-state", { state });
    return state;
  }

  async clientInformation() {
    return readJson("client-information");
  }

  async saveClientInformation(clientInformation) {
    writeJson("client-information", clientInformation);
  }

  async tokens() {
    return readJson("tokens");
  }

  async saveTokens(tokens) {
    writeJson("tokens", tokens);
  }

  async saveCodeVerifier(codeVerifier) {
    writeJson("code-verifier", { codeVerifier });
  }

  async codeVerifier() {
    const saved = readJson("code-verifier");

    if (!saved?.codeVerifier) {
      throw new Error("Missing OAuth code verifier.");
    }

    return saved.codeVerifier;
  }

  async redirectToAuthorization(authorizationUrl) {
    console.log("\nAuthorize Robinhood MCP by opening this URL:\n");
    console.log(String(authorizationUrl));
    console.log("");

    await open(String(authorizationUrl));
  }

  async saveAuthorizationServerUrl(authorizationServerUrl) {
    writeJson("authorization-server-url", { authorizationServerUrl });
  }

  async authorizationServerUrl() {
    return readJson("authorization-server-url")?.authorizationServerUrl;
  }

  async saveResourceUrl(resourceUrl) {
    writeJson("resource-url", { resourceUrl });
  }

  async resourceUrl() {
    return readJson("resource-url")?.resourceUrl;
  }

  async saveDiscoveryState(discoveryState) {
    writeJson("discovery-state", discoveryState);
  }

  async discoveryState() {
    return readJson("discovery-state");
  }

  async invalidateCredentials(scope) {
    if (scope === "all") {
      deleteJson("client-information");
      deleteJson("tokens");
      deleteJson("code-verifier");
      deleteJson("authorization-server-url");
      deleteJson("resource-url");
      deleteJson("discovery-state");
      deleteJson("oauth-state");
      return;
    }

    if (scope === "client") {
      deleteJson("client-information");
      return;
    }

    if (scope === "tokens") {
      deleteJson("tokens");
      return;
    }

    if (scope === "verifier") {
      deleteJson("code-verifier");
      return;
    }

    if (scope === "discovery") {
      deleteJson("authorization-server-url");
      deleteJson("resource-url");
      deleteJson("discovery-state");
    }
  }
}