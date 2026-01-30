// Simple Postgres client wrapper. This file abstracts the connection pool and
// provides a basic query helper. It uses the `pg` package, which must be
// installed when you run `npm install`. If `DATABASE_URL` is not set, the
// pool will not be created and queries will throw.

import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || null;
// Only create a pool if a connection string is provided. This allows the
// application to start even when no database is configured (e.g. local
// development). At runtime, you should set DATABASE_URL to something like
// postgres://user:password@host:port/database
const pool = connectionString ? new Pool({ connectionString }) : null;

export async function query(text, params) {
  if (!pool) {
    throw new Error('No database connection configured. Set DATABASE_URL to connect to Postgres.');
  }
  return pool.query(text, params);
}