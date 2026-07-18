import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { DemoMockClient } from '../askranger/demo-mock.js';
import { HttpAskRangerClient } from '../askranger/http.js';
import type { AskRangerClient, CallEvent } from '../askranger/types.js';
import type { Loop } from '../domain/types.js';
import { ClaudeDecider } from '../orchestrator/claude-decider.js';
import type { Decider } from '../orchestrator/decider.js';
import type { OrchestratorDeps } from '../orchestrator/engine.js';
import { buildCenterPrompt, buildPatientPrompt } from '../orchestrator/prompt.js';
import { LoopRuntime } from './runtime.js';
import { verifySignature } from './signing.js';

export interface BuildHttpAppOptions {
  runtime: LoopRuntime;
  webhookSecret: string;
  webDistDir?: string;
  logger?: boolean;
}

function parseJsonBody<T>(body: unknown): T {
  if (typeof body !== 'string') throw new Error('Expected raw JSON body');
  return JSON.parse(body) as T;
}

function loopSummary(loop: Loop) {
  return {
    id: loop.id,
    state: loop.state,
    patientName: loop.fhir.patient?.name ?? loop.order?.patient.name ?? null,
    study: loop.order?.study.type ?? null,
    dueDate: loop.order?.urgency.due_date ?? null,
    centersTried: loop.calls.filter(({ target }) => target === 'center').length,
    slotsFound: loop.slots.length,
    escalationCount: loop.escalations.length,
    lastTimeline: loop.timeline.at(-1) ?? null,
  };
}

export function buildHttpApp(options: BuildHttpAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.post('/webhooks/askranger', async (request, reply) => {
    const rawBody = request.body;
    if (typeof rawBody !== 'string') return await reply.code(400).send({ error: 'raw body required' });
    const signatureHeader = request.headers['x-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!verifySignature(rawBody, signature, options.webhookSecret)) {
      return await reply.code(401).send({ error: 'invalid signature' });
    }
    let event: CallEvent;
    try {
      event = JSON.parse(rawBody) as CallEvent;
    } catch {
      return await reply.code(400).send({ error: 'invalid JSON' });
    }
    await options.runtime.onWebhookEvent(event);
    return await reply.code(200).send({ ok: true });
  });

  app.post('/api/loops', async (request, reply) => {
    let body: { documentText?: string };
    try {
      body = parseJsonBody(request.body);
    } catch {
      return await reply.code(400).send({ error: 'invalid JSON body' });
    }
    if (body.documentText === undefined || body.documentText.trim() === '') {
      return await reply.code(400).send({ error: 'documentText is required' });
    }
    const loop = await options.runtime.startLoop(body.documentText);
    return await reply.code(202).send({ loopId: loop.id, state: loop.state });
  });

  app.get('/api/loops', async () => options.runtime.store.getAll().map(loopSummary));

  app.get<{ Params: { id: string } }>('/api/loops/:id', async (request, reply) => {
    const loop = options.runtime.store.get(request.params.id);
    return loop === undefined ? await reply.code(404).send({ error: 'loop not found' }) : loop;
  });

  app.get('/api/escalations', async () => options.runtime.store.getAll().flatMap((loop) =>
    loop.escalations.map((escalation) => ({
      loopId: loop.id,
      patientName: loop.fhir.patient?.name ?? loop.order?.patient.name ?? null,
      reason: escalation.reason,
      context: escalation.context,
      ts: escalation.ts,
    }))));

  if (options.webDistDir !== undefined && existsSync(options.webDistDir)) {
    void app.register(fastifyStatic, { root: options.webDistDir, prefix: '/' });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/webhooks')) {
        return await reply.code(404).send({ error: 'not found' });
      }
      return await reply.sendFile('index.html');
    });
  }

  return app;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') throw new Error(`${name} is required in live mode`);
  return value;
}

export function createProductionApp(options: {
  decider?: Decider;
  logger?: boolean;
} = {}): { app: FastifyInstance; runtime: LoopRuntime } {
  const mode = process.env.ASKRANGER_MODE ?? 'mock';
  if (mode !== 'mock' && mode !== 'live') throw new Error(`Invalid ASKRANGER_MODE: ${mode}`);

  const webhookSecret = process.env.EXTERNAL_API_WEBHOOK_SECRET ?? 'dev-webhook-secret';
  const port = Number(process.env.PORT ?? 8080);
  const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  const callbackUrl = `${publicUrl}/webhooks/askranger`;
  const webDistDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/dist');
  let client: AskRangerClient;
  let roster: string[];
  let patientPhoneOverride: string | undefined;

  if (mode === 'live') {
    const hostname = new URL(publicUrl).hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      throw new Error('ASKRANGER_MODE=live requires a public PUBLIC_URL');
    }
    roster = [
      process.env.CENTER_COMPLIANT,
      process.env.CENTER_NONCOMPLIANT,
      process.env.CENTER_NOANSWER,
    ].map((value) => value?.trim()).filter((value): value is string => value !== undefined && value !== '');
    if (roster.length === 0) throw new Error('At least one center phone is required in live mode');
    patientPhoneOverride = process.env.PATIENT_PHONE?.trim() || undefined;
    client = new HttpAskRangerClient({
      baseUrl: requiredEnv('ASKRANGER_BASE_URL'),
      apiKey: requiredEnv('ASKRANGER_API_KEY'),
      allowDeferredEndpointStubs: process.env.ALLOW_DEFERRED_ENDPOINT_STUBS === '1',
    });
  } else {
    roster = ['imaging-center-a', 'imaging-center-b'];
    client = new DemoMockClient({ callbackUrl, webhookSecret });
  }

  const deps: OrchestratorDeps = {
    client,
    decider: options.decider ?? new ClaudeDecider(),
    roster,
    now: () => new Date(),
    callbackUrl,
    callerIdentity: {
      onBehalfOf: "the ordering provider's office",
      persona: 'automated scheduling assistant',
    },
    guardrailProfile: 'healthcare_scheduling',
    buildCenterPrompt,
    buildPatientPrompt,
    ...(patientPhoneOverride === undefined ? {} : { patientPhoneOverride }),
  };
  const runtime = new LoopRuntime(deps, { webhookSecret });
  const app = buildHttpApp({
    runtime,
    webhookSecret,
    webDistDir,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  app.addHook('onClose', async () => { runtime.stop(); });
  return { app, runtime };
}
