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

      case 'agent:publish': {
        const { publishFromFiles } = await import('@kora/ai');
        log.info(await publishFromFiles(), 'published from config files');
        return 0;
      }

      case 'agent:versions': {
        const { listVersions } = await import('@kora/db');
        for (const v of await listVersions(serverEnv().KORA_TENANT_ID)) {
          console.log(`v${v.version}  ${v.status.padEnd(9)}  ${v.model}  ${v.id}`);
        }
        return 0;
      }

      case 'agent:rollback': {
        const { activate, previousActive } = await import('@kora/db');
        const tenantId = serverEnv().KORA_TENANT_ID;
        const previous = await previousActive(tenantId);
        if (!previous) {
          console.error('there is no archived version to roll back to');
          return 1;
        }
        const restored = await activate(tenantId, previous.id, 'cli');
        log.info({ versionId: restored.id, version: restored.version }, 'rolled back');
        return 0;
      }

      case 'replay': {
        const { replay, renderReplay } = await import('@kora/evaluation');
        const { runAgentTurn, makeJudgeCaller } = await import('@kora/ai');
        const { loadActive } = await import('@kora/db');
        const tenantId = serverEnv().KORA_TENANT_ID;
        const arg = (name: string) => {
          const at = rest.indexOf(`--${name}`);
          return at === -1 ? undefined : rest[at + 1];
        };

        const active = await loadActive(tenantId).catch(() => null);
        const from = arg('from') ?? active?.id;
        const against = arg('against') ?? from;
        if (!from || !against) {
          console.error(
            'replay needs --from <versionId> and --against <versionId>; run `pnpm kora agent:versions` to list them',
          );
          return 1;
        }

        const limitRaw = Number(arg('limit'));
        const report = await replay({
          tenantId,
          fromVersionId: from,
          againstVersionId: against,
          deps: {
            runAgentTurn,
            judge: { call: makeJudgeCaller(tenantId) },
          },
          ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
        });

        console.log(renderReplay(report));

        // Self-replay must be clean. Drift against the identical version means
        // uncontrolled non-determinism, and every later replay number is noise.
        if (from === against && report.regressions.length > 0) {
          console.error(
            `\nSelf-replay produced ${report.regressions.length} regression(s). Fix determinism before trusting any replay number.`,
          );
          return 1;
        }
        return 0;
      }

      case 'agent:promote': {
        const { promote, loadActive } = await import('@kora/db');
        const tenantId = serverEnv().KORA_TENANT_ID;
        const arg = (name: string) => {
          const at = rest.indexOf(`--${name}`);
          return at === -1 ? undefined : rest[at + 1];
        };
        const versionId = arg('version');
        if (!versionId) {
          console.error('agent:promote needs --version <versionId>');
          return 1;
        }

        const accepted = (arg('accept') ?? '').split(',').filter(Boolean);
        const result = await promote({
          tenantId,
          versionId,
          actorId: arg('actor') ?? 'cli',
          evidence: {
            benchmarkPassed: rest.includes('--benchmark-passed'),
            ...(arg('benchmark') ? { benchmarkRunId: arg('benchmark') } : {}),
            ...(arg('replay') ? { replayRunId: arg('replay') } : {}),
            ...(arg('compared') ? { replayCompared: Number(arg('compared')) } : {}),
            ...(arg('vrr-delta') ? { replayVrrDelta: Number(arg('vrr-delta')) } : {}),
            ...(arg('regressions')
              ? { regressions: (arg('regressions') ?? '').split(',').filter(Boolean) }
              : {}),
          },
          acceptedRegressions: accepted,
          ...(arg('note') ? { note: arg('note') } : {}),
        });

        if (!result.promoted) {
          console.error('Promotion blocked:');
          for (const b of result.blocked) console.error(`  ${b.gate}: ${b.reason}`);
          return 1;
        }

        const now = await loadActive(tenantId);
        log.info({ versionId: now.id, version: now.version }, 'promoted');
        return 0;
      }

      case 'bench': {
        const { runBench } = await import('@kora/evaluation');
        const { runAgentTurn, makeJudgeCaller } = await import('@kora/ai');
        return runBench(rest, {
          runAgentTurn,
          judge: { call: makeJudgeCaller(serverEnv().KORA_TENANT_ID) },
        });
      }

      case 'chaos': {
        const { runChaos, chaosFailures, renderChaos } = await import('@kora/evaluation');
        const { runAgentTurn, makeJudgeCaller } = await import('@kora/ai');
        const flag = (name: string, fallback: number) => {
          const raw = rest.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
          const n = raw === undefined ? Number.NaN : Number(raw);
          return Number.isFinite(n) ? n : fallback;
        };

        const results = await runChaos({
          deps: {
            runAgentTurn,
            judge: { call: makeJudgeCaller(serverEnv().KORA_TENANT_ID) },
          },
          faultRate: flag('fault-rate', 0.2),
          repeat: flag('repeat', 3),
          category: rest.find((a) => a.startsWith('--category='))?.split('=')[1],
        });

        console.log(renderChaos(results));
        const problems = chaosFailures(results);
        if (problems.length > 0) {
          console.error('\nChaos found correctness failures:');
          for (const p of problems) console.error(`  ${p}`);
          return 1;
        }
        console.log(
          '\nNo duplicate writes, no actions after a deny, no stuck runs, no false claims.',
        );
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

      case 'security:isolation': {
        const { buildManifest, unguardedRoutes } = await import('./isolation-suite.js');
        const manifest = buildManifest(process.cwd());
        const unguarded = unguardedRoutes(manifest);
        for (const r of manifest) {
          console.log(`${r.guarded ? 'guarded' : 'public '}  ${r.path}`);
        }
        if (unguarded.length > 0) {
          console.error(`\n${unguarded.length} route(s) with no operator check.`);
          return 1;
        }
        console.log(`\n${manifest.length} routes, none unguarded.`);
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
          'usage: pnpm kora <ingest|migrate|seed|idempotency:cleanup|smoke:model|scenarios|bench|chaos|replay|agent:publish|agent:versions|agent:promote|agent:rollback|judge:goldset|judge:calibrate|approvals:expire|security:isolation>',
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
