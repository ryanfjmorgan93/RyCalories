export interface DatasetEntry {
  id: string;
  name: string;
  force?: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

export interface MappedEntry {
  slug: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  kind: string;
  isCompound: boolean;
  unilateral: boolean;
  level: string;
}

export function slugOf(id: string): string;
export function muscleGroupOf(raw: Pick<DatasetEntry, 'name' | 'primaryMuscles'>): string;
/** `name` is optional: only an EZ bar filed under barbell needs it. */
export function equipmentOf(raw: Pick<DatasetEntry, 'equipment'> & Partial<Pick<DatasetEntry, 'name'>>): string;
export function kindOf(raw: Pick<DatasetEntry, 'name' | 'equipment' | 'category'>): string;
/** `name`, `equipment` and `primaryMuscles` are optional: body-only abdominal work and the named isolation moves need them. */
export function isCompoundOf(raw: Pick<DatasetEntry, 'mechanic' | 'secondaryMuscles'> & Partial<Pick<DatasetEntry, 'name' | 'equipment' | 'primaryMuscles'>>): boolean;
export function mapEntry(raw: DatasetEntry): MappedEntry;
