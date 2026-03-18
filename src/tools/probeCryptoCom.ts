import { config } from "../config/env";
import { runCryptoComAuthProbe } from "../diagnostics/cryptocomProbe";
import { CryptoComPrivateReadOnlyClient } from "../exchange/cryptocomPrivateReadOnly";

async function main(): Promise<void> {
  const result = await runCryptoComAuthProbe({
    apiKey: config.cryptocomApiKey,
    apiSecret: config.cryptocomApiSecret,
    clientFactory: () =>
      new CryptoComPrivateReadOnlyClient({
        apiKey: config.cryptocomApiKey ?? "",
        apiSecret: config.cryptocomApiSecret ?? "",
        apiBaseUrl: config.cryptocomExchangePrivateBaseUrl
      })
  });

  console.log(JSON.stringify(result, null, 2));
}

void main();
