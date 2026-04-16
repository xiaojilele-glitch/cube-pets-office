/**
 * Reputation module entry point.
 *
 * Exports singleton instances of ReputationService and DecayScheduler,
 * and provides an init function to start the decay scheduler on server boot.
 *
 * @see Requirements 2.3, 6.1
 */

import { DEFAULT_REPUTATION_CONFIG } from "../../../shared/reputation.js";
import { ReputationCalculator } from "./reputation-calculator.js";
import { TrustTierEvaluator } from "./trust-tier-evaluator.js";
import { AnomalyDetector } from "./anomaly-detector.js";
import { ReputationService } from "./reputation-service.js";
import { DecayScheduler } from "./decay-scheduler.js";
import { AssignmentScorer } from "./assignment-scorer.js";

const config = DEFAULT_REPUTATION_CONFIG;
const calculator = new ReputationCalculator(config);
const evaluator = new TrustTierEvaluator(config);
const detector = new AnomalyDetector(config);

export const reputationService = new ReputationService(
  calculator,
  evaluator,
  detector,
  config
);
export const decayScheduler = new DecayScheduler(config, evaluator, calculator);
export const assignmentScorer = new AssignmentScorer(config);

/**
 * Initialize the reputation module: start the decay scheduler.
 * Call this during server startup.
 */
export function initReputation(): void {
  decayScheduler.start();
  console.log("[Reputation] Module initialized, decay scheduler started");
}

/**
 * Shutdown the reputation module: stop the decay scheduler.
 */
export function shutdownReputation(): void {
  decayScheduler.stop();
}

// Re-export types and classes for convenience
export { ReputationService } from "./reputation-service.js";
export { ReputationCalculator } from "./reputation-calculator.js";
export { TrustTierEvaluator } from "./trust-tier-evaluator.js";
export { AnomalyDetector } from "./anomaly-detector.js";
export { DecayScheduler } from "./decay-scheduler.js";
export { AssignmentScorer } from "./assignment-scorer.js";
