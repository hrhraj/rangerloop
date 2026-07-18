export interface PlaceCallRequest {
  idempotencyKey: string;
  toPhone: string;
  callbackUrl: string;
  script: {
    systemPrompt: string;
    captureSchema: Record<string, 'string' | 'datetime' | 'bool' | 'number'>;
  };
  guardrailProfile?: string | null;
  calleeType?: 'person' | 'business';
  callerIdentity: { onBehalfOf: string; persona: string };
  metadata?: Record<string, unknown>;
}

export interface SmsRequest {
  idempotencyKey: string;
  toPhone: string;
  body: string;
  callbackUrl?: string;
}

export interface InboundExpectRequest {
  idempotencyKey: string;
  fromPhone: string;
  answerNumber: string;
  ttlSeconds: number;
  context: {
    systemPrompt: string;
    guardrailProfile?: string | null;
    state: Record<string, unknown>;
  };
  callbackUrl?: string;
}

export type CallEventType =
  | 'call.started'
  | 'call.ivr_navigating'
  | 'call.on_hold'
  | 'call.human_reached'
  | 'call.completed'
  | 'call.failed';

export interface CallOutcome {
  reached: 'human' | 'voicemail' | 'ivr_deadend' | 'no_answer';
  captured: Record<string, unknown>;
  guardrail: { profile: string | null; violations: string[]; flags: string[] };
  transcriptUrl?: string;
  recordingUrl?: string;
  summary?: string;
}

export interface CallEvent {
  event: CallEventType;
  callId: string;
  idempotencyKey: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  outcome?: CallOutcome;
}

export interface CallStatus {
  callId: string;
  status: 'accepted' | 'in_progress' | 'completed' | 'failed';
  outcome: CallOutcome | null;
}

export type DeliverWebhook = (event: CallEvent) => void | Promise<void>;

export interface AskRangerClient {
  placeCall(req: PlaceCallRequest): Promise<{
    callId: string;
    status: 'accepted';
    idempotencyKey: string;
  }>;
  getCall(callId: string): Promise<CallStatus>;
  sendSms(req: SmsRequest): Promise<{ messageId: string; status: 'queued' }>;
  armInboundExpect(req: InboundExpectRequest): Promise<{
    expectationId: string;
    status: 'armed';
    expiresAt: string;
  }>;
}
