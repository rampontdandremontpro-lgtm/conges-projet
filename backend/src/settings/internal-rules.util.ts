export interface InternalRule {
  id: string;
  title: string;
  content: string;
  icon: string;
}

export interface InternalRuleInput {
  title: string;
  content: string;
  icon?: string | null;
}

// Icônes autorisées (alignées sur la sélection proposée côté frontend).
export const ALLOWED_INTERNAL_RULE_ICONS: ReadonlyArray<string> = [
  'clock',
  'sun',
  'calendar',
  'check',
  'shield',
  'users',
  'info',
  'alert',
  'bell',
  'file',
  'doc',
  'chart',
  'wallet',
  'building',
  'sparkles',
  'ban',
  'eye',
  'settings',
  'list',
  'refresh',
  'user',
];

// Variables de texte autorisées, remplacées par leurs valeurs réelles au
// moment de l'affichage (côté frontend). Cette liste est la référence de
// validation : toute autre variable est refusée.
export const INTERNAL_RULE_VARIABLES: ReadonlyArray<string> = [
  'delai_normal',
  'delai_special',
  'seuil_duree',
  'debut_ete',
  'fin_ete',
  'delai_modification',
  'debut_periode',
  'fin_periode',
];

export const DEFAULT_INTERNAL_RULES: InternalRule[] = [
  {
    id: 'notice-deadlines',
    title: 'Délais de prévenance',
    content:
      'Déposez votre demande au moins {{delai_normal}} calendaires avant le départ. Ce délai passe à {{delai_special}} pour un congé d’au moins {{seuil_duree}} calendaires ou qui chevauche la période estivale.',
    icon: 'clock',
  },
  {
    id: 'summer-period',
    title: 'Période estivale et demandes particulières',
    content:
      'La période estivale s’étend du {{debut_ete}} au {{fin_ete}} inclus. Un congé qui chevauche cette période, ou d’une durée d’au moins {{seuil_duree}} calendaires, est soumis à un délai de dépôt de {{delai_special}}.',
    icon: 'sun',
  },
  {
    id: 'reference-periods',
    title: 'Périodes de référence N-1, N et N+1',
    content:
      'Les congés sont comptabilisés par période de référence allant du {{debut_periode}} au {{fin_periode}} de l’année suivante. Votre solde se compose des droits N-1, N et N+1.',
    icon: 'calendar',
  },
  {
    id: 'deduction',
    title: 'Décompte des jours ouvrables et demi-journées',
    content:
      'Les dimanches et les jours fériés non travaillés ne sont pas décomptés. Une demande peut être posée en journée entière ou en demi-journée (matin ou après-midi). Règle interne GMES : un congé qui se termine le vendredi après-midi décompte également le samedi suivant.',
    icon: 'check',
  },
  {
    id: 'derogations-modifications',
    title: 'Dérogations et modifications de demandes',
    content:
      'Si le délai de prévenance n’est pas respecté, une dérogation peut être demandée jusqu’au début du congé ; elle est examinée par la RH. Une demande déjà soumise ne peut plus être modifiée dans les {{delai_modification}} précédant le départ.',
    icon: 'shield',
  },
  {
    id: 'validation',
    title: 'Validation des demandes',
    content:
      'Chaque demande est soumise à la validation des personnes compétentes. Le circuit dépend de votre rattachement et de l’existence éventuelle d’une dérogation ; il peut impliquer votre responsable, la RH ou la direction.',
    icon: 'users',
  },
];

const VARIABLE_PATTERN = /{{([a-z_]+)}}/g;

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function extractVariableNames(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    names.add(match[1]);
  }
  return [...names];
}

export function normalizeInternalRuleInput(
  input: InternalRuleInput,
): Omit<InternalRule, 'id'> {
  const title = cleanText(input?.title, 120);
  const content = cleanText(input?.content, 2000);
  const icon = cleanText(input?.icon ?? '', 40) || 'info';

  if (!title) {
    throw new Error('Le titre de la règle est obligatoire.');
  }
  if (!content) {
    throw new Error('Le contenu de la règle est obligatoire.');
  }
  if (!ALLOWED_INTERNAL_RULE_ICONS.includes(icon)) {
    throw new Error(`L’icône « ${icon} » n’est pas autorisée.`);
  }
  if (/<[a-z][^>]*>/i.test(content)) {
    throw new Error('Le contenu ne peut pas contenir de HTML.');
  }

  const unknownVariables = extractVariableNames(content).filter(
    (name) => !INTERNAL_RULE_VARIABLES.includes(name),
  );
  if (unknownVariables.length > 0) {
    throw new Error(
      `Variable inconnue : {{${unknownVariables[0]}}}. Variables autorisées : ${INTERNAL_RULE_VARIABLES.map((name) => `{{${name}}}`).join(', ')}.`,
    );
  }

  return { title, content, icon };
}

export function parseInternalRules(raw: string | null): InternalRule[] {
  if (raw === null) {
    return DEFAULT_INTERNAL_RULES.map((item) => ({ ...item }));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_INTERNAL_RULES.map((item) => ({ ...item }));
  }

  if (!Array.isArray(parsed)) {
    return DEFAULT_INTERNAL_RULES.map((item) => ({ ...item }));
  }

  // Un tableau vide est conservé tel quel : toutes les règles ont été
  // volontairement supprimées, elles ne doivent pas réapparaître.
  const result: InternalRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const id = cleanText((item as any).id, 120);
    if (!id) continue;
    try {
      const normalized = normalizeInternalRuleInput(item as InternalRuleInput);
      result.push({ id, ...normalized });
    } catch {
      // Une règle mal formée ne doit pas casser toute la page.
    }
  }
  return result;
}
