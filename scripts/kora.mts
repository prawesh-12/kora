import { join } from 'node:path';
import { config } from 'dotenv';

config({ path: join(import.meta.dirname, '../.env'), quiet: true });

const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<number> {
  const { logger, serverEnv } = await import('@kora/core');
  const { closeDb } = await import('@kora/db');
  const log = logger();

  try {
    switch (command) {
      case 'ingest': {
        const { ingestDirectory } = await import('@kora/ai');
        const dir = rest[0] ?? 'config/knowledge';
        const results = await ingestDirectory({
          tenantId: serverEnv().KORA_TENANT_ID,
          dir: join(process.cwd(), dir),
        });
        const ingested = results.filter((r) => !r.skipped).length;
        log.info({ ingested, skipped: results.length - ingested }, 'ingest complete');
        return 0;
      }

      case 'migrate': {
        const { runMigrations } = await import('@kora/db');
        await runMigrations();
        log.info('migrations applied');
        return 0;
      }

      case 'seed': {
        const { seed } = await import('@kora/db');
        log.info(await seed(), 'seed complete');
        return 0;
      }

      case 'idempotency:cleanup': {
        const { cleanupExpired } = await import('@kora/tools');
        log.info({ deleted: await cleanupExpired() }, 'idempotency cleanup complete');
        return 0;
      }

      case 'smoke:model': {
        const { callModel } = await import('@kora/ai');
        const { generateText } = await import('ai');
        const result = await callModel({
          purpose: 'classifier',
          tenantId: serverEnv().KORA_TENANT_ID,
          timeoutMs: 15_000,
          fn: (model, signal) =>
            generateText({
              model,
              prompt: 'My coffee machine from order 9832 arrived broken.',
              abortSignal: signal,
            }),
        });
        if (!result.ok) {
          log.error({ code: result.error.code }, 'smoke call failed');
          return 1;
        }
        log.info({ text: result.value.text.slice(0, 200) }, 'smoke call ok');
        return 0;
      }

      case 'judge:calibrate': {
        const { calibrate, calibrationPasses, renderCalibration } = await import(
          '@kora/evaluation'
        );
        const { makeJudgeCaller } = await import('@kora/ai');
        const dir = rest[0] ?? join(process.cwd(), 'benchmarks/gold');
        const results = await calibrate({
          goldSetPath: dir,
          call: makeJudgeCaller(serverEnv().KORA_TENANT_ID),
        });
        console.log(renderCalibration(results));
        return calibrationPasses(results) ? 0 : 1;
      }

      case 'judge:goldset': {
        const { buildGoldSet } = await import('@kora/evaluation');
        const written = await buildGoldSet({
          tenantId: serverEnv().KORA_TENANT_ID,
          outDir: join(process.cwd(), 'benchmarks/gold'),
        });
        log.info({ written }, 'gold set written');
        return 0;
      }

      case 'approvals:expire': {
        const { expireOverdueApprovals } = await import('@kora/db');
        const expired = await expireOverdueApprovals(serverEnv().KORA_TENANT_ID);
        log.info({ expired: expired.length }, 'approval sweep complete');
        return 0;
      }

      case 'scenarios': {
        const { runScenarios } = await import('@kora/evaluation');
        const { runAgentTurn, makeJudgeCaller } = await import('@kora/ai');
        const judge = rest.includes('--no-judge')
          ? undefined
          : { call: makeJudgeCaller(serverEnv().KORA_TENANT_ID) };
        return runScenarios(rest, { runAgentTurn, ...(judge ? { judge } : {}) });
      }

      default:
        console.error(
          'usage: pnpm kora <ingest|migrate|seed|idempotency:cleanup|smoke:model|scenarios|judge:goldset|judge:calibrate|approvals:expire>',
        );
        return 1;
    }
  } finally {
    await closeDb().catch(() => {});
  }
}

const code = await main();
// Keep-alive sockets from fetch and the postgres pool hold the event loop open,
// and a CLI that will not exit is worse than one that exits abruptly.
process.exit(code);
