export interface WritebackAction {
  type: string;
  action: string;
  params: Record<string, unknown>;
}

export interface WritebackResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface WritebackAdapter {
  type: string;
  allowedActions: string[];
  execute(action: WritebackAction): Promise<WritebackResult>;
}
