import { z } from 'zod';

export const careerVisibilitySchema = z.enum(['public', 'limited', 'private']);
export type CareerVisibility = z.infer<typeof careerVisibilitySchema>;
export type AccountSettings = { careerVisibility: CareerVisibility; otherSessions: number };
