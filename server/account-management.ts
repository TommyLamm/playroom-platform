import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { userRoleSchema, type AccountList, type ManagedAccount } from '../shared/account.js';
import type { Store } from './db.js';
import { AppError } from './errors.js';

export function registerAccountManagement(app: FastifyInstance, store: Store, requireAccounts: (request: FastifyRequest) => Promise<void>) {
  const sql = store.sqlite;
  app.get('/api/v1/admin/accounts', { preHandler: requireAccounts }, async (request): Promise<AccountList> => {
    const { search, page } = z.object({ search: z.string().trim().max(32).default(''), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().parse(request.query);
    const pageSize = 20;
    // instr treats underscores and percent signs as literal search text.
    const where = 'instr(lower(username),lower(?))>0';
    const total = (sql.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${where}`).get(search) as { n: number }).n;
    const accounts = sql.prepare(`SELECT id,username,role,created_at AS createdAt FROM users WHERE ${where} ORDER BY username COLLATE NOCASE,id LIMIT ? OFFSET ?`).all(search, pageSize, (page - 1) * pageSize) as ManagedAccount[];
    return { accounts, total, page, pageSize };
  });
  app.post('/api/v1/admin/accounts/:id/role', { preHandler: requireAccounts }, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { role, expectedRole } = z.object({ role: userRoleSchema, expectedRole: userRoleSchema }).strict().parse(request.body);
    const account = sql.transaction(() => {
      const current = sql.prepare('SELECT id,username,role,created_at AS createdAt FROM users WHERE id=?').get(id) as ManagedAccount | undefined;
      if (!current) throw new AppError(404, '找不到帳號');
      if (current.role !== expectedRole) throw new AppError(409, '帳號角色已變更，請重新整理後再試');
      if (current.role === 'admin' && role !== 'admin' && (sql.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get() as { n: number }).n <= 1)
        throw new AppError(409, '至少須保留一位平台管理員，請先指派另一位管理員');
      sql.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
      return { ...current, role };
    }).immediate();
    return { account };
  });
}
