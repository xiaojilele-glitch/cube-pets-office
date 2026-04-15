/**
 * Property 22: 图谱导出往返一致性
 *
 * Feature: knowledge-graph, Property 22: 图谱导出往返一致性
 * Validates: Requirements 8.5
 *
 * For any project graph data, exporting via getAllEntities/getAllRelations
 * (the same data path used by GET /api/admin/knowledge/export) SHALL produce
 * an equivalent set of entities and relations (same entityIds, same attributes,
 * same relations).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { GraphStore } from "../knowledge/graph-store.js";
import type { Entity, Relation, EntitySource } from "../../shared/knowledge/types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const ENTITY_TYPES = [
  "CodeModule", "API", "BusinessRule", "ArchitectureDecision",
  "TechStack", "Agent", "Role", "Mission", "Bug", "Config",
] as const;

const RELATION_TYPES = [
  "DEPENDS_ON", "CALLS", "IMPLEMENTS", "DECIDED_BY", "SUPERSEDES",
  "USES", "CAUSED_BY", "RESOLVED_BY", "BELONGS_TO", "EXECUTED_BY", "KNOWS_ABOUT",
] as const;

const SOURCES: EntitySource[] = [
  "agent_extracted", "user_defined", "code_analysis", "llm_inferred",
];

const sourceArb = fc.constantFrom(...SOURCES);

const entityInputArb = (projectId: string) =>
  fc.record({
    entityType: fc.constantFrom(...ENTITY_TYPES),
    name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    description: fc.string({ maxLength: 60 }),
    source: sourceArb,
    confidence: fc.double({ min: 0.5, max: 1.0, noNaN: true }),
    needsReview: fc.constant(false),
    linkedMemoryIds: fc.constant([] as string[]),
    extendedAttributes: fc.constant({} as Record<string, unknown>),
  }).map((rec) => ({ ...rec, projectId }));

// Generate 1-8 unique entity inputs for a single project
const entityListArb = (projectId: string) =>
  fc.array(entityInputArb(projectId), { minLength: 1, maxLength: 8 });

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Property 22: 图谱导出往返一致性", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it(
    "exported entities and relations match the originally created data",
    () => {
      fc.assert(
        fc.property(
          entityListArb("export-roundtrip-template"),
          fc.constantFrom(...RELATION_TYPES),
          (entityInputs, relType) => {
            const projectId = `export-roundtrip-${randomUUID()}`;
            // Fresh store per iteration
            const s = new GraphStore();
            const inputsForProject = entityInputs.map((input) => ({
              ...input,
              projectId,
            }));

            // 1. Create entities
            const created: Entity[] = [];
            for (const input of inputsForProject) {
              created.push(s.createEntity(input));
            }

            // 2. Create relations between consecutive entities (if ≥ 2)
            const createdRelations: Relation[] = [];
            for (let i = 0; i < created.length - 1; i++) {
              const rel = s.createRelation({
                relationType: relType,
                sourceEntityId: created[i].entityId,
                targetEntityId: created[i + 1].entityId,
                weight: 0.8,
                evidence: "test-evidence",
                source: "code_analysis",
                confidence: 0.9,
                needsReview: false,
              });
              createdRelations.push(rel);
            }

            // 3. Export — same code path as the admin export endpoint
            s.load(projectId);
            const exportedEntities = s.getAllEntities(projectId);
            const exportedRelations = s.getAllRelations(projectId);

            // 4. Verify entity count
            expect(exportedEntities).toHaveLength(created.length);

            // 5. Verify every created entity appears in export with same attributes
            for (const original of created) {
              const exported = exportedEntities.find(
                (e) => e.entityId === original.entityId,
              );
              expect(exported).toBeDefined();
              expect(exported!.entityType).toBe(original.entityType);
              expect(exported!.name).toBe(original.name);
              expect(exported!.description).toBe(original.description);
              expect(exported!.source).toBe(original.source);
              expect(exported!.confidence).toBe(original.confidence);
              expect(exported!.projectId).toBe(original.projectId);
              expect(exported!.status).toBe(original.status);
              expect(exported!.createdAt).toBe(original.createdAt);
              expect(exported!.updatedAt).toBe(original.updatedAt);
            }

            // 6. Verify relation count
            expect(exportedRelations).toHaveLength(createdRelations.length);

            // 7. Verify every created relation appears in export with same attributes
            for (const original of createdRelations) {
              const exported = exportedRelations.find(
                (r) => r.relationId === original.relationId,
              );
              expect(exported).toBeDefined();
              expect(exported!.relationType).toBe(original.relationType);
              expect(exported!.sourceEntityId).toBe(original.sourceEntityId);
              expect(exported!.targetEntityId).toBe(original.targetEntityId);
              expect(exported!.weight).toBe(original.weight);
              expect(exported!.evidence).toBe(original.evidence);
              expect(exported!.source).toBe(original.source);
              expect(exported!.confidence).toBe(original.confidence);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
