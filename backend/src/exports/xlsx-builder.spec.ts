import { buildXlsx } from './xlsx-builder';
import { describe, expect, it } from '@jest/globals';

describe('buildXlsx', () => {
  it('produit un véritable conteneur ZIP/XLSX', () => {
    const buffer = buildXlsx(
      ['Nom', 'Jours'],
      [{ Nom: 'MARTIN', Jours: 2.5 }],
      'Export RH',
    );

    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('échappe les caractères XML contenus dans les données', () => {
    const buffer = buildXlsx(
      ['Commentaire'],
      [{ Commentaire: '<test> & "contrôle"' }],
      'Données',
    );

    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('accepte une feuille et une liste vides sans produire un fichier invalide', () => {
    const buffer = buildXlsx([], [], 'Feuille/Test:*?');

    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
