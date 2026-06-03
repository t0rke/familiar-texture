import http from "http";

export function createOAuthCallbackServer({ port = 59291, path = "/callback" } = {}) {
  let resolveCode;
  let rejectCode;

  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (url.pathname !== path) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        res.statusCode = 400;
        res.end("Authorization failed. You can close this tab.");
        rejectCode(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.statusCode = 400;
        res.end("Missing authorization code. You can close this tab.");
        rejectCode(new Error("OAuth callback did not include a code."));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(`
        <html>
          <body style="font-family: system-ui; padding: 32px;">
            <h2>Robinhood MCP authorized</h2>
            <p>You can close this tab and return to your terminal.</p>
          </body>
        </html>
      `);

      resolveCode(code);
    } catch (err) {
      rejectCode(err);
    }
  });

  async function start() {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });

    return {
      redirectUrl: `http://127.0.0.1:${port}${path}`,
      waitForCode: () => codePromise,
      close: () =>
        new Promise((resolve) => {
          server.close(() => resolve());
        }),
    };
  }

  return { start };
}