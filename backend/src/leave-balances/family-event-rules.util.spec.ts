import { LegalEntityConventionType } from '../legal-entities/legal-entity.entity';
import {
  applicableFamilyEventRule,
  FAMILY_EVENT_KINDS,
} from './family-event-rules.util';

describe('family-event-rules.util', () => {
  it('référence les 9 événements familiaux', () => {
    expect(FAMILY_EVENT_KINDS).toEqual([
      'MARIAGE_PACS',
      'MARIAGE_ENFANT',
      'NAISSANCE',
      'ADOPTION',
      'DECES',
      'DECES_ENFANT',
      'DEUIL_ENFANT',
      'ANNONCE_HANDICAP_ENFANT',
      'ENFANT_MALADE',
    ]);
  });

  it('mariage d’un enfant sous Syntec : 1 jour ouvré', () => {
    const r = applicableFamilyEventRule('MARIAGE_ENFANT', '2026-10-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(1);
    expect(r.unit).toBe('OUVRES');
    expect(r.source).toBe('CONVENTION_COLLECTIVE');
  });

  it('mariage d’un enfant en régime légal : 1 jour ouvrable rémunéré (L3142-4)', () => {
    const r = applicableFamilyEventRule('MARIAGE_ENFANT', '2026-10-01', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(1);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.paid).toBe(true);
    expect(r.anomalies).toEqual([]);
  });

  it('mariage d’un enfant Syntec 2023-2026 : 1 jour ouvré (version historique)', () => {
    const r = applicableFamilyEventRule('MARIAGE_ENFANT', '2025-06-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(1);
    expect(r.unit).toBe('OUVRES');
    expect(r.source).toBe('CONVENTION_COLLECTIVE');
  });

  it('mariage d’un enfant Syntec avant le 01/05/2023 : minimum légal + vérification RH', () => {
    const r = applicableFamilyEventRule('MARIAGE_ENFANT', '2022-06-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(1);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.source).toBe('CODE_TRAVAIL');
    expect(r.anomalies.some((a) => /01\/05\/2023/i.test(a))).toBe(true);
  });

  it('mariage/Pacs : légal 4 jours ouvrables', () => {
    const r = applicableFamilyEventRule('MARIAGE_PACS', '2026-10-01', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(4);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.source).toBe('CODE_TRAVAIL');
  });

  it('mariage/Pacs sous Syntec : 4 jours ouvrés (pas 5)', () => {
    const r = applicableFamilyEventRule('MARIAGE_PACS', '2026-10-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(4);
    expect(r.unit).toBe('OUVRES');
    expect(r.source).toBe('CONVENTION_COLLECTIVE');
  });

  it('naissance : 3 jours ouvrables', () => {
    const r = applicableFamilyEventRule('NAISSANCE', '2026-10-01', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRABLES');
  });

  it('décès d’un enfant < 25 ans : 14 jours ouvrables', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2026-10-01', LegalEntityConventionType.LEGAL, { enfantAge: 10 });
    expect(r.days).toBe(14);
    expect(r.unit).toBe('OUVRABLES');
  });

  it('décès d’un enfant < 25 ans sous Syntec : 14 jours OUVRÉS (pas ouvrables)', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2026-10-01', LegalEntityConventionType.SYNTEC, { enfantAge: 10 });
    expect(r.days).toBe(14);
    expect(r.unit).toBe('OUVRES');
    expect(r.source).toBe('CONVENTION_COLLECTIVE');
  });

  it('décès d’un enfant ≥ 25 ans : 12 jours ouvrables', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2026-10-01', LegalEntityConventionType.LEGAL, { enfantAge: 30 });
    expect(r.days).toBe(12);
  });

  it('décès d’un enfant de 25 ans ou plus lui-même parent : 14 jours', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2026-10-01', LegalEntityConventionType.LEGAL, { enfantAge: 30, enfantEstParent: true });
    expect(r.days).toBe(14);
  });

  it('personne de moins de 25 ans à charge effective et permanente : 14 jours', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2026-10-01', LegalEntityConventionType.SYNTEC, { personneChargeMoins25: true });
    expect(r.days).toBe(14);
    expect(r.unit).toBe('OUVRES');
  });

  it('décès d’un enfant sans âge : anomalie de vérification RH', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2026-10-01', LegalEntityConventionType.LEGAL);
    expect(r.anomalies.some((a) => /vérification RH/i.test(a))).toBe(true);
  });

  it('congé de deuil : 8 jours ouvrables distincts, fractionnable, 1 an', () => {
    const r = applicableFamilyEventRule('DEUIL_ENFANT', '2026-10-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(8);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.reference).toBe('L3142-1-1');
    expect(r.fractionnement).toMatch(/un an/i);
  });

  it('annonce handicap avant le 14/06/2026 : 5 jours ouvrables', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2026-06-13', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(5);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.source).toBe('CODE_TRAVAIL');
  });

  it('annonce handicap le 20/07/2023 : 2 jours ouvrables (version 2021-2023)', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2023-07-20', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(2);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.reference).toMatch(/19\/12\/2021/);
  });

  it('annonce handicap le 21/07/2023 : 5 jours ouvrables', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2023-07-21', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(5);
    expect(r.unit).toBe('OUVRABLES');
  });

  it('annonce handicap le 13/06/2026 : 5 jours ouvrables', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2026-06-13', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(5);
    expect(r.unit).toBe('OUVRABLES');
  });

  it('annonce handicap en 2017 (handicap uniquement) : 2 jours ouvrables', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2017-06-01', LegalEntityConventionType.LEGAL, { natureAnnonce: 'HANDICAP' });
    expect(r.days).toBe(2);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.reference).toMatch(/10\/08\/2016/);
  });

  it('annonce handicap en 2020 (handicap uniquement) : 2 jours ouvrables', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2020-01-15', LegalEntityConventionType.LEGAL, { natureAnnonce: 'HANDICAP' });
    expect(r.days).toBe(2);
    expect(r.unit).toBe('OUVRABLES');
  });

  it('annonce pathologie chronique avant le 19/12/2021 : non couverte, vérification RH', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2021-12-18', LegalEntityConventionType.LEGAL, { natureAnnonce: 'PATHOLOGIE_CHRONIQUE' });
    expect(r.days).toBe(0);
    expect(r.daysCertain).toBe(false);
    expect(r.anomalies.some((a) => /19\/12\/2021/i.test(a))).toBe(true);
  });

  it('annonce handicap avant le 10/08/2016 : non applicable, vérification RH', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2016-08-09', LegalEntityConventionType.LEGAL, { natureAnnonce: 'HANDICAP' });
    expect(r.days).toBe(0);
    expect(r.daysCertain).toBe(false);
  });

  it('annonce handicap à partir du 14/06/2026 : 10 jours ouvrables', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2026-06-14', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(10);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.source).toBe('CODE_TRAVAIL');
  });

  it('enfant malade : 3 jours (enfant ≥ 1 an), non rémunéré', () => {
    const r = applicableFamilyEventRule('ENFANT_MALADE', '2026-10-01', LegalEntityConventionType.LEGAL, { enfantAge: 5 });
    expect(r.days).toBe(3);
    expect(r.paid).toBe(false);
    expect(r.reference).toBe('L1225-61');
  });

  it('enfant malade : 5 jours (enfant < 1 an), non rémunéré', () => {
    const r = applicableFamilyEventRule('ENFANT_MALADE', '2026-10-01', LegalEntityConventionType.LEGAL, { enfantAge: 0 });
    expect(r.days).toBe(5);
    expect(r.paid).toBe(false);
  });

  it('décès (proche) : 3 jours ouvrables, lien identifié', () => {
    const r = applicableFamilyEventRule('DECES', '2026-10-01', LegalEntityConventionType.LEGAL, { lien: 'CONJOINT' });
    expect(r.days).toBe(3);
    expect(r.conditions).toMatch(/conjoint/i);
  });

  it('décès du conjoint sous Syntec : 3 jours ouvrés', () => {
    const r = applicableFamilyEventRule('DECES', '2026-10-01', LegalEntityConventionType.SYNTEC, { lien: 'CONJOINT' });
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRES');
    expect(r.source).toBe('CONVENTION_COLLECTIVE');
  });

  it('décès du père/mère sous Syntec : 3 jours ouvrés', () => {
    const r = applicableFamilyEventRule('DECES', '2026-10-01', LegalEntityConventionType.SYNTEC, { lien: 'PARENT' });
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRES');
  });

  it('décès d’un frère/sœur sous Syntec : 3 jours ouvrés', () => {
    const r = applicableFamilyEventRule('DECES', '2026-10-01', LegalEntityConventionType.SYNTEC, { lien: 'FRERE_SOEUR' });
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRES');
  });

  it('décès d’un beau-parent sous Syntec : 3 jours ouvrés', () => {
    const r = applicableFamilyEventRule('DECES', '2026-10-01', LegalEntityConventionType.SYNTEC, { lien: 'BEAU_PARENT' });
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRES');
  });

  it('décès d’un autre ascendant sous Syntec : 2 jours ouvrés', () => {
    const r = applicableFamilyEventRule('DECES', '2026-10-01', LegalEntityConventionType.SYNTEC, { lien: 'AUTRE_ASCENDANT' });
    expect(r.days).toBe(2);
    expect(r.unit).toBe('OUVRES');
  });

  it('décès d’un autre proche : lien non couvert (0 jour + anomalie RH)', () => {
    const r = applicableFamilyEventRule('DECES', '2026-10-01', LegalEntityConventionType.LEGAL, { lien: 'AUTRE' });
    expect(r.days).toBe(0);
    expect(r.anomalies.some((a) => /vérification RH/i.test(a))).toBe(true);
  });

  it('naissance sous Syntec : 3 jours OUVRÉS avec début de période', () => {
    const r = applicableFamilyEventRule('NAISSANCE', '2026-10-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRES');
    expect(r.conditions).toMatch(/jour de la naissance/i);
  });

  // ── Corrections A/B/C ───────────────────────────────────────────────────
  it('décès d’un enfant ≥ 25 ans en 2022 (régime légal 2020-2023) : 5 jours ouvrables', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2022-06-01', LegalEntityConventionType.LEGAL, { enfantAge: 30 });
    expect(r.days).toBe(5);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.reference).toMatch(/01\/07\/2020/);
    expect(r.daysCertain).toBe(true);
  });

  it('décès d’un enfant < 25 ans en 2022 (régime légal 2020-2023) : 7 jours ouvrés', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2022-06-01', LegalEntityConventionType.LEGAL, { enfantAge: 10 });
    expect(r.days).toBe(7);
    expect(r.unit).toBe('OUVRES');
  });

  it('décès d’un enfant en 2019 (2016-2020) : 5 jours ouvrables', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2019-06-01', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(5);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.reference).toMatch(/10\/08\/2016/);
    expect(r.daysCertain).toBe(true);
  });

  it('décès d’un enfant avant le 10/08/2016 : 3 jours ouvrables', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2016-08-09', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.reference).toMatch(/antérieure au 10\/08\/2016/);
  });

  it('décès d’un enfant < 25 ans en juin 2023 sous Syntec : 7 jours ouvrés (conditions connues)', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2023-06-15', LegalEntityConventionType.SYNTEC, { enfantAge: 10 });
    expect(r.days).toBe(7);
    expect(r.unit).toBe('OUVRES');
    expect(r.source).toBe('CONVENTION_COLLECTIVE');
    expect(r.daysCertain).toBe(true);
  });

  it('décès d’un enfant en août 2023 sous Syntec : 12 jours ouvrables (minimum légal)', () => {
    const r = applicableFamilyEventRule('DECES_ENFANT', '2023-08-15', LegalEntityConventionType.SYNTEC, { enfantAge: 30 });
    expect(r.days).toBe(12);
    expect(r.unit).toBe('OUVRABLES');
    expect(r.source).toBe('CODE_TRAVAIL');
  });

  it('naissance sous Syntec 2023-2026 : quinze jours entourant, sans découpage fixe 7/7', () => {
    const r = applicableFamilyEventRule('NAISSANCE', '2025-06-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(3);
    expect(r.unit).toBe('OUVRES');
    expect(r.temporalWindow).toEqual({ beforeDays: 14, afterDays: 14 });
    expect(r.fractionnement).toMatch(/entourant/i);
  });

  it('adoption sous Syntec 2023-2026 : fenêtre de quinze jours SUIVANT l’arrivée', () => {
    const r = applicableFamilyEventRule('ADOPTION', '2024-06-01', LegalEntityConventionType.SYNTEC);
    expect(r.days).toBe(3);
    expect(r.temporalWindow).toEqual({ beforeDays: 0, afterDays: 14 });
  });

  it('naissance Syntec 2026 : 3 jours ouvrés consécutifs, début naissance ou 1er jour ouvré suivant', () => {
    const r = applicableFamilyEventRule('NAISSANCE', '2026-10-01', LegalEntityConventionType.SYNTEC);
    expect(r.consecutive).toBe(true);
    expect(r.startMode).toBe('BIRTH_OR_NEXT_WORKING');
  });

  it('adoption Syntec 2026 : 3 jours ouvrés consécutifs, début dans les 7 jours avant/arrivée/1er ouvré suivant', () => {
    const r = applicableFamilyEventRule('ADOPTION', '2026-10-01', LegalEntityConventionType.SYNTEC);
    expect(r.consecutive).toBe(true);
    expect(r.startMode).toBe('ADOPTION_2026');
  });

  it('annonce handicap sans nature en 2017 : information à vérifier (pas d’attribution automatique)', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2017-06-01', LegalEntityConventionType.LEGAL);
    expect(r.daysCertain).toBe(false);
    expect(r.anomalies.some((a) => /non renseignée/i.test(a))).toBe(true);
  });

  it('annonce handicap sans nature en 2024 : information à vérifier', () => {
    const r = applicableFamilyEventRule('ANNONCE_HANDICAP_ENFANT', '2024-06-01', LegalEntityConventionType.LEGAL);
    expect(r.days).toBe(5);
    expect(r.daysCertain).toBe(false);
  });
});
