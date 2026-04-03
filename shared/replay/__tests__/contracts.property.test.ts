import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type {
  ExecutionEvent,
  ReplayEventType,
  CommunicationEventData,
  DecisionEventData,
  CodeExecutionEventData,
  ResourceAccessEventData,
  MessageType,
  MessageStatus,
  ExecutionStatus,
  ResourceType,
  AccessType,
} from '../contracts';
import {
  REPLAY_EVENT_TYPES,
  MESSAGE_TYPES,
  MESSAGE_STATUSES,
  EXECUTION_STATUSES,
  RESOURCE_TYPES,
  ACCESS_TYPES,
} from '../contracts';

/* ─── Arbitraries ─── */

const nonEmptyString = fc.string({ minLength: 1 });

const messageTypeArb: fc.Arbitrary<MessageType> = fc.constantFrom(...MESSAGE_TYPES);
const messageStatusArb: fc.Arbitrary<MessageStatus> = fc.constantFrom(...MESSAGE_STATUSES);
const executionStatusArb: fc.Arbitrary<ExecutionStatus> = fc.constantFrom(...EXECUTION_STATUSES);
const resourceTypeArb: fc.Arbitrary<ResourceType> = fc.constantFrom(...RESOURCE_TYPES);
const accessTypeArb: fc.Arbitrary<AccessType> = fc.constantFrom(...ACCESS_TYPES);

const communicationDataArb: fc.Arbitrary<CommunicationEventData> = fc.record({
  senderId: nonEmptyString,
  receiverId: nonEmptyString,
  messageId: nonEmptyString,
  messageContent: nonEmptyString,
  messageType: messageTypeArb,
  status: messageStatusArb,
});

const decisionDataArb: fc.Arbitrary<DecisionEventData> = fc.record({
  decisionId: nonEmptyString,
  agentId: nonEmptyString,
  decisionInput: fc.constant({} as Record<string, unknown>),
  decisionLogic: nonEmptyString,
  decisionResult: fc.anything(),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

const codeExecutionDataArb: fc.Arbitrary<CodeExecutionEventData> = fc.record({
  agentId: nonEmptyString,
  codeSnippet: nonEmptyString,
  codeLanguage: nonEmptyString,
  executionInput: fc.constant({} as Record<string, unknown>),
  executionOutput: fc.record({
    stdout: fc.string(),
    stderr: fc.string(),
  }),
  executionStatus: executionStatusArb,
  executionTime: fc.nat(),
});

const resourceAccessDataArb: fc.Arbitrary<ResourceAccessEventData> = fc.record({
  agentId: nonEmptyString,
  resourceType: resourceTypeArb,
  resourceId: nonEmptyString,
  accessType: accessTypeArb,
  accessResult: fc.record({
    success: fc.boolean(),
    duration: fc.nat(),
  }),
});

/** Map event types that have typed eventData to their arbitraries */
const typedEventTypes = [
  'MESSAGE_SENT',
  'MESSAGE_RECEIVED',
  'DECISION_MADE',
  'CODE_EXECUTED',
  'RESOURCE_ACCESSED',
] as const;

type TypedEventType = (typeof typedEventTypes)[number];

function eventDataArbFor(eventType: TypedEventType): fc.Arbitrary<Record<string, unknown>> {
  switch (eventType) {
    case 'MESSAGE_SENT':
    case 'MESSAGE_RECEIVED':
      return communicationDataArb as unknown as fc.Arbitrary<Record<string, unknown>>;
    case 'DECISION_MADE':
      return decisionDataArb as unknown as fc.Arbitrary<Record<string, unknown>>;
    case 'CODE_EXECUTED':
      return codeExecutionDataArb as unknown as fc.Arbitrary<Record<string, unknown>>;
    case 'RESOURCE_ACCESSED':
      return resourceAccessDataArb as unknown as fc.Arbitrary<Record<string, unknown>>;
  }
}

/** Arbitrary for a typed ExecutionEvent (one of the 5 typed event types) */
const typedExecutionEventArb: fc.Arbitrary<ExecutionEvent> = fc
  .constantFrom(...typedEventTypes)
  .chain((eventType) =>
    fc.record({
      eventId: nonEmptyString,
      missionId: nonEmptyString,
      timestamp: fc.nat(),
      eventType: fc.constant(eventType as ReplayEventType),
      sourceAgent: nonEmptyString,
      eventData: eventDataArbFor(eventType),
    }),
  );

/** Arbitrary for any ExecutionEvent (all 9 event types) */
const anyExecutionEventArb: fc.Arbitrary<ExecutionEvent> = fc
  .constantFrom(...REPLAY_EVENT_TYPES)
  .chain((eventType) => {
    const isTyped = (typedEventTypes as readonly string[]).includes(eventType);
    const dataArb = isTyped
      ? eventDataArbFor(eventType as TypedEventType)
      : fc.constant({} as Record<string, unknown>);
    return fc.record({
      eventId: nonEmptyString,
      missionId: nonEmptyString,
      timestamp: fc.nat(),
      eventType: fc.constant(eventType),
      sourceAgent: nonEmptyString,
      eventData: dataArb,
    });
  });

/* ─── Tests ─── */

// Feature: collaboration-replay, Property 1: Event structure completeness
describe('Property 1: Event structure completeness', () => {
  const COMMUNICATION_FIELDS: (keyof CommunicationEventData)[] = [
    'senderId',
    'receiverId',
    'messageId',
    'messageContent',
    'messageType',
    'status',
  ];

  const DECISION_FIELDS: (keyof DecisionEventData)[] = [
    'decisionId',
    'agentId',
    'decisionInput',
    'decisionLogic',
    'decisionResult',
    'confidence',
  ];

  const CODE_EXECUTION_FIELDS: (keyof CodeExecutionEventData)[] = [
    'agentId',
    'codeSnippet',
    'codeLanguage',
    'executionInput',
    'executionOutput',
    'executionStatus',
    'executionTime',
  ];

  const RESOURCE_ACCESS_FIELDS: (keyof ResourceAccessEventData)[] = [
    'agentId',
    'resourceType',
    'resourceId',
    'accessType',
    'accessResult',
  ];

  it('should have all required fields for typed event types', () => {
    // **Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1**
    fc.assert(
      fc.property(typedExecutionEventArb, (event: ExecutionEvent) => {
        const data = event.eventData;
        let requiredFields: string[];

        switch (event.eventType) {
          case 'MESSAGE_SENT':
          case 'MESSAGE_RECEIVED':
            requiredFields = COMMUNICATION_FIELDS;
            break;
          case 'DECISION_MADE':
            requiredFields = DECISION_FIELDS;
            break;
          case 'CODE_EXECUTED':
            requiredFields = CODE_EXECUTION_FIELDS;
            break;
          case 'RESOURCE_ACCESSED':
            requiredFields = RESOURCE_ACCESS_FIELDS;
            break;
          default:
            requiredFields = [];
        }

        for (const field of requiredFields) {
          expect(field in data).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should have non-empty common fields for all event types', () => {
    // **Validates: Requirements 1.1**
    fc.assert(
      fc.property(anyExecutionEventArb, (event: ExecutionEvent) => {
        expect(event.eventId).toBeTruthy();
        expect(event.missionId).toBeTruthy();
        expect(typeof event.timestamp).toBe('number');
        expect(event.eventType).toBeTruthy();
        expect(REPLAY_EVENT_TYPES).toContain(event.eventType);
        expect(event.sourceAgent).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: collaboration-replay, Property 7: Decision confidence range invariant
describe('Property 7: Decision confidence range invariant', () => {
  it('confidence must satisfy 0 <= confidence <= 1 for any DecisionEventData', () => {
    // **Validates: Requirements 3.5**
    fc.assert(
      fc.property(decisionDataArb, (decision: DecisionEventData) => {
        expect(decision.confidence).toBeGreaterThanOrEqual(0);
        expect(decision.confidence).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });
});
