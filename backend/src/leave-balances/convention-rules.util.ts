/**
 * JUR-024 — résolution des règles applicables à partir de la convention de
 * BRANCHE enregistrée par entité. Composant PUR (aucune écriture).
 *
 * Priorité juridique par matière (sans présumer que « la disposition la plus
 * favorable » prévaut systématiquement) :
 *  - Ancienneté (jours supplémentaires) : matière conventionnelle (Syntec 5.1).
 *    Aucune règle légale supplétive. Applicable uniquement si la branche est
 *    explicitement SYNTEC.
 *  - Fractionnement : base légale (L3141-23, jours ouvrables) ; la branche
 *    peut y déroger (Syntec, jours ouvrés).
 *
 * L'accord d'entreprise est un CHAMP SÉPARÉ (overlay) : il ne remplace pas la
 * convention de branche et ne modifie aucun calcul tant que ses dispositions
 * ne sont pas explicitement renseignées et validées par la RH.
 */
import { LegalEntityConventionType } from '../legal-entities/legal-entity.entity';

export type RuleSource =
  | 'CODE_TRAVAIL'
  | 'CONVENTION_COLLECTIVE'
  | 'ACCORD_ENTREPRISE';

export interface SeniorityRuleResolution {
  applicable: boolean;
  source: RuleSource | null;
  reason: string;
}

export interface FractionnementRuleResolution {
  regime: 'SYNTEC' | 'LEGAL';
  source: RuleSource;
  reason: string;
  /** true si la configuration RH contredit la branche (aucun calcul auto). */
  contradiction: boolean;
}

export function resolveSeniorityRule(
  conventionType: LegalEntityConventionType,
): SeniorityRuleResolution {
  switch (conventionType) {
    case LegalEntityConventionType.SYNTEC:
      return {
        applicable: true,
        source: 'CONVENTION_COLLECTIVE',
        reason: 'Syntec 5.1 — ancienneté conventionnelle',
      };
    case LegalEntityConventionType.LEGAL:
      return {
        applicable: false,
        source: null,
        reason: 'Régime légal supplétif confirmé — pas de jours d’ancienneté conventionnels',
      };
    case LegalEntityConventionType.NON_RENSEIGNEE:
    default:
      return {
        applicable: false,
        source: null,
        reason: 'Convention de branche non renseignée — aucune règle conventionnelle appliquée',
      };
  }
}

export function resolveFractionnementRule(
  conventionType: LegalEntityConventionType,
  configuredRegime?: 'SYNTEC' | 'LEGAL' | 'NONE',
): FractionnementRuleResolution {
  switch (conventionType) {
    case LegalEntityConventionType.SYNTEC:
      return {
        regime: 'SYNTEC',
        source: 'CONVENTION_COLLECTIVE',
        reason: 'Syntec 5.1 — jours ouvrés',
        contradiction: false,
      };
    case LegalEntityConventionType.LEGAL:
      return {
        regime: 'LEGAL',
        source: 'CODE_TRAVAIL',
        reason: 'L3141-23 — régime légal supplétif confirmé',
        contradiction: configuredRegime === 'SYNTEC',
      };
    case LegalEntityConventionType.NON_RENSEIGNEE:
    default:
      return {
        regime: 'LEGAL',
        source: 'CODE_TRAVAIL',
        reason: 'Légal supplétif à confirmer (convention de branche non renseignée)',
        contradiction: configuredRegime === 'SYNTEC',
      };
  }
}
