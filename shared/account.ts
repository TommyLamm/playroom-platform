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
export type UserRole = 'player' | 'admin';
export type Session =
  | { authenticated: false }
  | { authenticated: true; username: string; role: UserRole; csrf: string };
