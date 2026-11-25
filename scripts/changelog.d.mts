interface Section {
  version: string;
  intro: string[];
  categories: Record<'Breaking' | 'Added' | 'Fixed' | 'Internal', string[]>;
}
export function parse(text: string): { sections: Section[]; errors: string[] };
export function titleErrors(parsed: ReturnType<typeof parse>): string[];
export function entryParts(raw: string): { title?: string; library: boolean; details: string[]; legacy: string };
