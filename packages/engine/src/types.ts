/**
 * Engine input/output contracts. These Zod schemas ARE the science spec:
 * the derivation object is the audit artifact every classification emits,
 * and replaying (factSet, policy) through a pinned engine version must
 * reproduce it byte-identically.
 */
import { z } from "zod";

// ---------- Facts (the extraction layer's output, the engine's only evidence) ----------

export const FactStatus = z.enum(["FOUND", "NOT_FOUND", "MANUAL"]);

/** A verbatim anchor into a source document. `text` must string-match the document at `span`. */
export const Citation = z.object({
  docIndex: z.number().int().nonnegative(),
  span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  text: z.string().min(1),
});

export const FactValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const Fact = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    status: FactStatus,
    value: FactValue.optional(),
    unit: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    citation: Citation.optional(),
    attestedBy: z.string().optional(),
  })
  .superRefine((fact, ctx) => {
    if (fact.status === "FOUND" && (fact.value === undefined || fact.citation === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "FOUND facts must carry a value and a citation",
      });
    }
    if (fact.status === "MANUAL" && fact.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MANUAL facts must carry a value",
      });
    }
    if (fact.status === "NOT_FOUND" && fact.value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NOT_FOUND facts must not carry a value — absence is absence",
      });
    }
  });

export const FactSet = z.object({
  facts: z.array(Fact),
  /** Present when any fact came from an extractor; pinned for reproducibility. */
  extraction: z
    .object({
      model: z.string(),
      promptHash: z.string(),
    })
    .optional(),
});

// ---------- Classification subject ----------

export const Subject = z.object({
  initiatorKind: z.enum(["human", "agent"]),
  initiator: z.string(),
  /** Required when initiatorKind is "agent": the accountable human owner. */
  onBehalfOf: z.string().optional(),
  actionType: z.string().optional(),
});

// ---------- The derivation object (the audit artifact) ----------

export const CategoryEvaluation = z.object({
  category: z.string(),
  handling: z.enum(["scored", "escalated_conservative", "needs_info"]),
  impactBand: z.string().optional(),
  bandRuleFired: z.string().optional(),
  likelihoodBand: z.string().optional(),
  likelihoodRulesFired: z.array(z.string()).optional(),
  matrixRating: z.string().optional(),
  appetiteRowApplied: z.enum(["default", "agent_initiated"]).optional(),
  requiredTier: z.number().int().nonnegative().optional(),
  appetiteBreached: z.boolean().optional(),
  /** How many bands separate this exposure from the next tier boundary (counterfactual fuel). */
  distanceFromNextBoundary: z
    .object({ bands: z.number().int(), direction: z.enum(["above", "below"]) })
    .optional(),
  missingFacts: z.array(z.string()).optional(),
});

export const TriggerOutcome = z.object({
  id: z.string(),
  fired: z.boolean(),
  minTier: z.number().int().nonnegative().optional(),
  tierUplift: z.number().int().positive().optional(),
});

/**
 * Composition is upward-only: every step after baseTier may raise the tier,
 * never lower it. This is an engine invariant, property-tested.
 */
export const Composition = z.object({
  baseTier: z.object({
    tier: z.number().int().nonnegative(),
    bindingCategory: z.string(),
  }),
  /** All triggers are recorded, fired or not — auditors need what was CHECKED. */
  triggers: z.array(TriggerOutcome),
  accumulation: z
    .object({
      countAtOrAbove: z.string(),
      observedCount: z.number().int().nonnegative(),
      threshold: z.number().int(),
      applied: z.boolean(),
    })
    .optional(),
  agentUplift: z
    .object({
      appliedVia: z.enum(["appetite_agent_initiated", "default_uplift", "none"]),
      selfApproveFloorApplied: z.boolean(),
    })
    .optional(),
  finalTier: z.number().int().nonnegative(),
});

export const Derivation = z.object({
  engineVersion: z.string(),
  policy: z.object({
    id: z.string(),
    version: z.number().int().positive(),
    contentHash: z.string(),
  }),
  subject: Subject,
  documents: z.array(z.object({ name: z.string(), sha256: z.string() })),
  factSet: FactSet,
  categoryEvaluations: z.array(CategoryEvaluation),
  composition: Composition.optional(),
  /** Template-generated from this object, never LLM-generated. */
  explanation: z.string(),
});

// ---------- The engine's result ----------

export const ClassificationResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ROUTED"),
    tier: z.number().int().nonnegative(),
    tierName: z.string(),
    derivation: Derivation,
  }),
  z.object({
    status: z.literal("INCOMPLETE"),
    missingFacts: z.array(
      z.object({ category: z.string(), facts: z.array(z.string()) })
    ),
    derivation: Derivation,
  }),
]);

export type FactStatus = z.infer<typeof FactStatus>;
export type Citation = z.infer<typeof Citation>;
export type Fact = z.infer<typeof Fact>;
export type FactSet = z.infer<typeof FactSet>;
export type Subject = z.infer<typeof Subject>;
export type CategoryEvaluation = z.infer<typeof CategoryEvaluation>;
export type TriggerOutcome = z.infer<typeof TriggerOutcome>;
export type Composition = z.infer<typeof Composition>;
export type Derivation = z.infer<typeof Derivation>;
export type ClassificationResult = z.infer<typeof ClassificationResult>;
