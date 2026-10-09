import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/)
  .transform((value) => value.toLowerCase());
export const registrationSchema = z
  .object({ username: usernameSchema, password: z.string().min(12).max(256) })
  .strict();
export const userRoleSchema = z.enum(['player', 'game_manager', 'analyst', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;
export type Permission = 'games.manage' | 'analytics.read' | 'visitors.read' | 'platform.manage' | 'accounts.manage';
export const roleLabels: Record<UserRole, string> = {
  player: '普通玩家', game_manager: '遊戲管理者', analyst: '數據分析員', admin: '平台管理員',
};
export const roleDescriptions: Record<UserRole, string> = {
  player: '遊玩遊戲與管理個人帳號，不能進入後台。',
  game_manager: '管理全部遊戲的來源、匯入、預覽、發布及下架。',
  analyst: '唯讀遊戲與訪客彙總統計，不能查看訪客個人明細。',
  admin: '全部後台功能，包含帳號權限、訪客明細及平台更新。',
};
const rolePermissions: Record<UserRole, readonly Permission[]> = {
  player: [], game_manager: ['games.manage'], analyst: ['analytics.read'],
  admin: ['games.manage', 'analytics.read', 'visitors.read', 'platform.manage', 'accounts.manage'],
};
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}
export function canAccessAdmin(role: UserRole): boolean {
  return hasPermission(role, 'games.manage') || hasPermission(role, 'analytics.read') || hasPermission(role, 'platform.manage') || hasPermission(role, 'accounts.manage');
}
export type ManagedAccount = { id: number; username: string; role: UserRole; createdAt: string };
export type AccountList = { accounts: ManagedAccount[]; total: number; page: number; pageSize: number };
export type Session =
  | { authenticated: false }
  | { authenticated: true; username: string; role: UserRole; csrf: string };
