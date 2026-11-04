/**
 * JUR-027 — Compatibilité : le moteur d'allocation a été extrait vers le module
 * métier partagé `../carryover-allocation.core`. Ce fichier est conservé comme
 * simple ré-export pour ne pas casser les imports existants.
 */
export {
  allocateCarryoverLots,
  calculateDeductedLeaveDayList,
  isLotConsumable,
} from '../carryover-allocation.core';
export type {
  CarryoverLotAllocationResult,
  ConsumableLotInput,
  DatedLeaveDay,
  LotAllocation,
  LotEligibility,
  SkippedLot,
} from '../carryover-allocation.core';
