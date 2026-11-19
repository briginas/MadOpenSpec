export interface Issue {
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface ProjectConfig {
  madOpenSpecVersion?: string;
  schemaVersion: number;
  bmad: {version: string; manifest: string; epics: string; sprintStatus: string};
  openspec: {version: string; root: string; schema: string};
}
export interface Project {root: string; config: ProjectConfig}
export interface ProjectPaths {manifest: string; epics: string; sprintStatus: string; openspecRoot: string}
export interface Story {id: string; title: string | null; text?: string; line?: number; missing?: boolean}
export interface Epic {id: string; title: string | null}

export interface DependencyField {label: string; line: number; value: string}
export interface DependencyStory {
  storyId: string;
  title: string | null;
  extractionState: 'known' | 'unknown' | 'invalid';
  dependsOn: string[] | null;
  fields: DependencyField[];
  issues: Issue[];
}
export interface DependencyExtraction {
  schemaVersion: number;
  source: {path: string; sha256: string | null};
  stories: DependencyStory[];
  issues: Issue[];
}
export type DependencyState = 'ready' | 'blocked' | 'unknown' | 'invalid';
export interface DependencyBlocker {
  storyId: string;
  title: string | null;
  bmadStatus: string | null;
  phase: Phase | null;
  chain: string[];
}
export interface DependencyCheck {
  schemaVersion: number;
  storyId: string;
  dependencyState: DependencyState;
  dependsOn: string[] | null;
  blockedBy: DependencyBlocker[];
  issues: Issue[];
}

export interface Scenario {
  name: string;
  given?: string;
  when: string;
  then: string;
  and?: string[];
}
export type Requirement =
  | {operation: 'ADDED' | 'MODIFIED'; name: string; text: string; scenarios: Scenario[]}
  | {operation: 'REMOVED'; name: string; reason: string; migration: string}
  | {operation: 'RENAMED'; name: string; from: string};
export interface Capability {path: string; purpose?: string; requirements: Requirement[]}
export interface ChangeInput {
  schemaVersion: number;
  story: {id: string; source: string};
  title: string;
  why: string;
  references: {path: string; requirementId?: string}[];
  capabilities: Capability[];
  tasks?: string[];
}
export interface PreparedInput extends ChangeInput {
  capabilities: (Capability & {isNew?: boolean})[];
  sourceLink: string;
  referenceLinks: string[];
}
export interface ParsedRequirement {name: string; scenarios: string[]}

export interface TaskCounts {total: number; completed: number; remaining: number}
export interface Task {id: string; description: string; done: boolean; sourcePath: string; line: number}
export interface TaskReport extends TaskCounts {tasks: Task[]}
export interface Archive {
  change: string;
  archivedAs: string;
  path: string;
  specsUpdated: boolean;
  totals?: Record<string, number>;
}
export type Hashes = Record<string, string | null>;
export interface Receipt {archive: Archive; deltaHashes: Hashes; mainSpecs: Hashes; tasks: TaskCounts}
export type Phase = 'creating' | 'active' | 'archiving' | 'archived' | 'closed' | 'recovery-required';
export interface StoryLink {
  source: string;
  statusKey: string;
  storyFile: string | null;
  changeId: string;
  inputHash: string;
  phase: Phase;
  archivePath: string | null;
  receipt: Receipt | null;
  pending?: {deltaHashes: Hashes; mainBefore: Hashes};
}
export interface Registry {schemaVersion: number; stories: Record<string, StoryLink>}
export interface StatusRow {
  epicId: string;
  workflowState: WorkflowState;
  dependencyState: DependencyState;
  dependsOn: string[] | null;
  blockedBy: DependencyBlocker[];
  storyId: string;
  title: string | null;
  bmadStatus: string | null;
  changeId: string | null;
  archivePath: string | null;
  phase: Phase | null;
  tasks: TaskCounts | null;
  issues: Issue[];
}
export type WorkflowState = 'not-started' | 'prepared' | 'in-progress' | 'tasks-complete' | 'done' | 'attention' | 'unknown';
export interface StatusSource {
  state: 'present' | 'missing' | 'unknown' | 'ambiguous' | 'invalid';
  path: string | null;
  candidates?: string[];
}
export type WorkflowCounts = Record<WorkflowState, number> & {total: number};
export interface EpicStatus {
  epicId: string;
  title: string | null;
  bmadStatus: string | null;
  storyIds: string[];
  counts: WorkflowCounts;
}
export interface StatusReport {
  schemaVersion: number;
  stories: StatusRow[];
  issues: Issue[];
  inputs: {connection: StatusSource; backlog: StatusSource; sprintStatus: StatusSource};
  epics: EpicStatus[];
  summary: {
    stage: 'unknown' | 'planning' | 'not-connected' | 'ready' | 'implementation' | 'complete' | 'attention';
    counts: WorkflowCounts;
    activeStoryIds: string[];
    nextSteps: string[];
  };
}

export interface OpenSpecRoot {path: string; source?: string; role?: string}
export interface OpenSpecContext {root: OpenSpecRoot; members: unknown[]; status: {severity: string}[]}
export interface OpenSpecSchema {name: string; source: string; artifacts: string[]}
export interface OpenSpecChange {id: string; schema: string; path: string; metadataPath: string}
export interface OpenSpecStatus {
  changeName: string;
  schemaName: string;
  changeRoot: string;
  root?: OpenSpecRoot;
  applyRequires: string[];
  artifacts: {id: string; status: string; requires?: string[]}[];
  artifactPaths: Record<string, {existingOutputPaths: string[]}>;
}
export interface OpenSpec {
  version(): Promise<string>;
  schema(): Promise<OpenSpecSchema>;
  context(): Promise<OpenSpecContext>;
  create(id: string): Promise<OpenSpecChange>;
  status(id: string): Promise<OpenSpecStatus>;
  tasks(id: string): Promise<TaskReport>;
  validate(id: string): Promise<{valid: boolean}>;
  archive(id: string): Promise<Archive>;
}

export interface ProcessOptions {cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number}
export interface ProcessResult {code: number | null; stdout: string; stderr: string}
export type ProcessRunner = (file: string, args: string[], options?: ProcessOptions) => Promise<ProcessResult>;
export interface SetupSettings {
  userName: string;
  communicationLanguage: string;
  documentOutputLanguage: string;
  openspecRoot: string;
}
export type SetupOptions = Partial<SetupSettings> & {dryRun?: boolean};
export interface Installers {
  prerequisite?(): Promise<void>;
  bmad(root: string, settings: Omit<SetupSettings, 'openspecRoot'>): Promise<void>;
  openspec(root: string): Promise<void>;
}
export interface SetupStep {id: string; expected: string; actual: string | null; action: string; result: string}
export interface SetupReport {schemaVersion: number; dryRun: boolean; steps: SetupStep[]; toolchain: string; issues: Issue[]; nextSteps: string[]}
export interface BmadConfig {
  core?: Record<string, unknown>;
  modules?: {bmm?: Record<string, unknown>};
  [key: string]: unknown;
}
