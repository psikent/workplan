import { buildApp } from "./app.js";

const { app, config } = await buildApp({ logger: true, startScheduler: true });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
