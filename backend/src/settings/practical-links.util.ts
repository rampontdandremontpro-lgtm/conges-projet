export interface PracticalLink {
  id: string;
  title: string;
  description: string;
  url: string;
}

export interface PracticalLinkInput {
  title: string;
  description?: string | null;
  url: string;
}

export const DEFAULT_PRACTICAL_LINKS: PracticalLink[] = [
  {
    id: 'service-public-conges-payes',
    title: 'Règles officielles sur les congés payés',
    description: 'Consultez les informations officielles sur les congés payés sur Service-Public.fr.',
    url: 'https://www.service-public.fr/particuliers/vosdroits/F2258',
  },
];

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizePracticalLinkInput(input: PracticalLinkInput): Omit<PracticalLink, 'id'> {
  const title = cleanText(input?.title, 120);
  const description = cleanText(input?.description, 500);
  const url = cleanText(input?.url, 1000);

  if (!title) {
    throw new Error('Le titre du lien est obligatoire.');
  }
  if (!url) {
    throw new Error('L’URL du lien est obligatoire.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('L’URL du lien est invalide.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Seuls les liens HTTP et HTTPS sont autorisés.');
  }

  return { title, description, url: parsed.toString() };
}

export function parsePracticalLinks(raw: string | null): PracticalLink[] {
  if (raw === null) return DEFAULT_PRACTICAL_LINKS.map((item) => ({ ...item }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PRACTICAL_LINKS.map((item) => ({ ...item }));
  }

  if (!Array.isArray(parsed)) return DEFAULT_PRACTICAL_LINKS.map((item) => ({ ...item }));

  const result: PracticalLink[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const id = cleanText((item as any).id, 120);
    if (!id) continue;
    try {
      const normalized = normalizePracticalLinkInput(item as PracticalLinkInput);
      result.push({ id, ...normalized });
    } catch {
      // Un lien mal formé ne doit pas casser toute la page.
    }
  }
  return result;
}
