export type UpdateJob = {
  id: string;
  commit: string;
  phase: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  backup?: string;
};
export type UpdateStatus = {
  enabled: boolean;
  current: string;
  repository?: string;
  branch?: string;
  latest?: { commit: string; subject: string; date: string };
  checkedAt?: string;
  checkError?: string;
  jobs?: UpdateJob[];
};
