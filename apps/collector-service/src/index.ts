import { loadConfig } from "./config";
import { openDatabase } from "./db";
import { createServer } from "./server";

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const app = createServer(db, {
    provider: config.classifierProvider,
    openaiApiKey: config.openaiApiKey,
    openaiModel: config.openaiModel,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel
  });

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Collector service running on http://127.0.0.1:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`Writing usage data to ${config.dbPath}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
