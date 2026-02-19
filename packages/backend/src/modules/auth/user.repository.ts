import { query } from '../../shared/db';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createUser(
  email: string,
  passwordHash: string,
  name: string,
): Promise<User> {
  const result = await query<UserRow>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, password_hash, name, avatar_url, created_at, updated_at`,
    [email, passwordHash, name],
  );
  return toUser(result.rows[0]);
}

export async function findByEmail(email: string): Promise<User | null> {
  const result = await query<UserRow>(
    `SELECT id, email, password_hash, name, avatar_url, created_at, updated_at
     FROM users WHERE email = $1`,
    [email],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function findById(id: string): Promise<User | null> {
  const result = await query<UserRow>(
    `SELECT id, email, password_hash, name, avatar_url, created_at, updated_at
     FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}
