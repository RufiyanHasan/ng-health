export interface StagedEntry {
  version?: string;
  id?: string;
  stageId?: string;
  stage_id?: string;
  uuid?: string;
  [key: string]: unknown;
}
export function findStaged(listJson: unknown, version: string): StagedEntry | undefined;
export function stageIdOf(entry: StagedEntry | undefined): string | undefined;
export function main(): void;
