export function normaliseName(s: string): string;
export function splitEquipmentSuffix(name: string): { base: string; equipment: string };
export function nameKeys(name: string, equipment?: string): string[];
export function entryKeys(name: string, equipment: string): string[];
export function catalogueRepeats(entries: { name: string; equipment: string }[]): { key: string; names: [string, string] }[];
export function appNameKeys(sources: {
  demos: { name: string; equipment?: string }[];
  seeds: { name: string; aliases: string[]; equipment: string }[];
}): Map<string, string>;
export function seedNamesFromSource(text: string): { name: string; aliases: string[]; equipment: string }[];
