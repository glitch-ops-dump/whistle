import { buildWhistleApi } from "./app.js";
import { assertProductionDeploymentPreflight } from "./config/deploymentPreflight.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  const preflight = assertProductionDeploymentPreflight();
  const app = buildWhistleApi();
  await app.listen({ host, port });
  app.log.info({ host, port, deploymentPreflight: preflight.summary }, "Whistle MVP ticket spine API is running");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
