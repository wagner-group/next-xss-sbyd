export const STAGES = [
  "lint",
  "runtime",
  "recommended",
  "csp-report",
  "enforce",
] as const;
export type Stage = (typeof STAGES)[number];

export interface Location {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
}

export interface Diagnostic {
  readonly id: string;
  readonly category: string;
  readonly status: "pass" | "warning" | "error";
  readonly message: string;
  readonly action: string;
  readonly evidence?: string;
  readonly location?: Location;
}

export interface CommandReport {
  readonly schemaVersion: 1;
  readonly toolVersion: string;
  readonly presetVersion: string;
  readonly command: "check-config" | "audit" | "enable-config";
  readonly stage: Stage;
  readonly root: string;
  readonly complete: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly findings?: readonly AuditFinding[];
  readonly exemptions?: readonly Exemption[];
  readonly changes?: readonly PlannedChange[];
  readonly fileScope: readonly string[];
}

export interface AuditFinding extends Location {
  readonly ruleId: string;
  readonly messageId?: string;
  readonly message: string;
  readonly severity: 1 | 2;
  readonly category: string;
  readonly setup: boolean;
  readonly suppressed: boolean;
  readonly nodeType?: string;
  readonly scope: "app-effective" | "recommended";
}

export interface Exemption extends Location {
  readonly kind: "inline" | "bulk" | "restricted-import";
  readonly ruleId?: string;
  readonly justification?: string;
}

export interface PlannedChange {
  readonly file: string;
  readonly action: "create" | "modify" | "manual" | "install";
  readonly reason: string;
  readonly content?: string;
  readonly command?: string;
  readonly args?: readonly string[];
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
