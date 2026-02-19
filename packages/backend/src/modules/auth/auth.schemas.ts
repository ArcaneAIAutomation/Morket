import { z } from 'zod';

// --- Request Schemas ---

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// --- Inferred Types ---

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

// --- Response Types ---

export const authTokensResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AuthTokensResponse = z.infer<typeof authTokensResponseSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
