import {
  DEFAULT_INTERNAL_RULES,
  extractVariableNames,
  normalizeInternalRuleInput,
  parseInternalRules,
} from './internal-rules.util';

describe('internal-rules.util', () => {
  it('fournit six règles par défaut', () => {
    expect(DEFAULT_INTERNAL_RULES).toHaveLength(6);
    for (const rule of DEFAULT_INTERNAL_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.title).toBeTruthy();
      expect(rule.content).toBeTruthy();
      expect(rule.icon).toBeTruthy();
    }
  });

  it('parse null → règles par défaut (initialisation non destructive)', () => {
    const rules = parseInternalRules(null);
    expect(rules).toEqual(DEFAULT_INTERNAL_RULES);
  });

  it('parse un tableau vide → tableau vide (pas de réapparition)', () => {
    expect(parseInternalRules('[]')).toEqual([]);
  });

  it('parse un JSON invalide → règles par défaut', () => {
    expect(parseInternalRules('{pas du json')).toEqual(DEFAULT_INTERNAL_RULES);
  });

  it('normalise une règle valide avec variables connues', () => {
    const normalized = normalizeInternalRuleInput({
      title: 'Délais',
      content: 'Délai de {{delai_normal}} et {{delai_special}}.',
      icon: 'clock',
    });
    expect(normalized.title).toBe('Délais');
    expect(normalized.content).toBe('Délai de {{delai_normal}} et {{delai_special}}.');
    expect(normalized.icon).toBe('clock');
  });

  it('rejette un titre vide', () => {
    expect(() =>
      normalizeInternalRuleInput({ title: '  ', content: 'Texte', icon: 'info' }),
    ).toThrow('titre');
  });

  it('rejette un contenu vide', () => {
    expect(() =>
      normalizeInternalRuleInput({ title: 'Titre', content: '   ', icon: 'info' }),
    ).toThrow('contenu');
  });

  it('rejette une icône inconnue', () => {
    expect(() =>
      normalizeInternalRuleInput({ title: 'Titre', content: 'Texte', icon: 'pouet' }),
    ).toThrow('icône');
  });

  it('rejette le HTML dans le contenu', () => {
    expect(() =>
      normalizeInternalRuleInput({
        title: 'Titre',
        content: 'Texte <script>alert(1)</script>',
        icon: 'info',
      }),
    ).toThrow('HTML');
  });

  it('rejette une variable inconnue', () => {
    expect(() =>
      normalizeInternalRuleInput({
        title: 'Titre',
        content: 'Texte avec {{variable_inconnue}}',
        icon: 'info',
      }),
    ).toThrow('Variable inconnue');
  });

  it('extrait les noms de variables', () => {
    expect(extractVariableNames('A {{delai_normal}} B {{delai_special}}')).toEqual([
      'delai_normal',
      'delai_special',
    ]);
  });

  it('tronque titre et contenu aux longueurs maximales', () => {
    const normalized = normalizeInternalRuleInput({
      title: 'x'.repeat(300),
      content: 'y'.repeat(3000),
      icon: 'info',
    });
    expect(normalized.title).toHaveLength(120);
    expect(normalized.content).toHaveLength(2000);
  });
});
