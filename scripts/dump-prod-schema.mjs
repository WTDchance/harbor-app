#!/usr/bin/env node
/**
 * Dump prod Supabase public schema as SQL — no Docker, no Supabase CLI.
 *
 * Reads PROD_DB_URL from env (pass via --env-file=.env.prod-dump).
 * Writes a complete-enough DDL file: extensions, tables, columns, constraints,
 * indexes, RLS enablement, policies.
 *
 * Output: supabase/prod-schema.sql
 */

import { writeFileSync } from 'node:fs'
import pg from 'pg'

const { Client } = pg
const URL = process.env.PROD_DB_URL
if (!URL) {
  console.error('Set PROD_DB_URL in the env (use --env-file=.env.prod-dump).')
  process.exit(1)
}

const c = new Client({ connectionString: URL })
await c.connect()

async function q(sql, params = []) {
  const { rows } = await c.query(sql, params)
  return rows
}

const lines = []
lines.push(`-- Harbor prod public schema dump — generated ${new Date().toISOString()}`)
lines.push(`-- Source: db.oubmpjtbbobiuzumagec.supabase.co (harbor-app prod)`)
lines.push('')

// --- Extensions ---
const exts = await q(`SELECT extname FROM pg_extension WHERE extname NOT IN ('plpgsql') ORDER BY extname`)
lines.push('-- Extensions')
for (const { extname } of exts) {
  lines.push(`CREATE EXTENSION IF NOT EXISTS "${extname}";`)
}
lines.push('')

// --- Custom enum types ---
const enums = await q(`
  SELECT t.typname,
    array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
  GROUP BY t.typname
  ORDER BY t.typname
`)
lines.push(`-- Enum types (${enums.length})`)
for (const e of enums) {
  const labels = Array.isArray(e.labels)
    ? e.labels
    : String(e.labels).replace(/^\{|\}$/g, '').split(',').filter(Boolean)
  const labelsSQL = labels.map((l) => `'${String(l).replace(/'/g, "''")}'`).join(', ')
  lines.push(`DO $$ BEGIN CREATE TYPE public.${quoteIdent(e.typname)} AS ENUM (${labelsSQL}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
}
lines.push('')

// --- Tables + columns ---
const tables = await q(`
  SELECT c.oid, c.relname AS table_name, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname
`)

lines.push(`-- Tables (${tables.length})`)
lines.push('')

for (const { oid, table_name, relrowsecurity } of tables) {
  const cols = await q(`
    SELECT
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_value
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [oid])

  const colDefs = cols.map((col) => {
    let d = `  ${quoteIdent(col.name)} ${col.type}`
    if (col.default_value) d += ` DEFAULT ${col.default_value}`
    if (col.not_null) d += ' NOT NULL'
    return d
  }).join(',\n')

  lines.push(`CREATE TABLE IF NOT EXISTS public.${quoteIdent(table_name)} (`)
  lines.push(colDefs)
  lines.push(`);`)

  if (relrowsecurity) {
    lines.push(`ALTER TABLE public.${quoteIdent(table_name)} ENABLE ROW LEVEL SECURITY;`)
  }
  lines.push('')
}

// --- Constraints (PK, FK, UNIQUE, CHECK) ---
const constraints = await q(`
  SELECT
    n.nspname AS schema,
    cl.relname AS table_name,
    c.conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS def,
    c.contype
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'public'
  ORDER BY cl.relname, c.contype, c.conname
`)
lines.push(`-- Constraints (${constraints.length})`)
for (const r of constraints) {
  lines.push(`ALTER TABLE public.${quoteIdent(r.table_name)} ADD CONSTRAINT ${quoteIdent(r.constraint_name)} ${r.def};`)
}
lines.push('')

// --- Indexes (skip ones auto-created for constraints) ---
const indexes = await q(`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname NOT IN (
      SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('p','u')
    )
  ORDER BY tablename, indexname
`)
lines.push(`-- Indexes (${indexes.length})`)
for (const { indexdef } of indexes) {
  lines.push(`${indexdef};`)
}
lines.push('')

// --- RLS policies ---
const policies = await q(`
  SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname
`)
lines.push(`-- RLS policies (${policies.length})`)
for (const p of policies) {
  const roleArr = Array.isArray(p.roles)
    ? p.roles
    : typeof p.roles === 'string'
    ? p.roles.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
    : []
  const roles = roleArr.length ? ` TO ${roleArr.join(', ')}` : ''
  const using = p.qual ? ` USING (${p.qual})` : ''
  const check = p.with_check ? ` WITH CHECK (${p.with_check})` : ''
  lines.push(
    `CREATE POLICY ${quoteIdent(p.policyname)} ON public.${quoteIdent(p.tablename)} ` +
    `AS ${p.permissive}${p.cmd === 'ALL' ? '' : ' FOR ' + p.cmd}${roles}${using}${check};`,
  )
}
lines.push('')

await c.end()

writeFileSync('supabase/prod-schema.sql', lines.join('\n'))
console.log(`\nWrote supabase/prod-schema.sql`)
console.log(`  ${exts.length} extensions`)
console.log(`  ${tables.length} tables`)
console.log(`  ${constraints.length} constraints`)
console.log(`  ${indexes.length} indexes`)
console.log(`  ${policies.length} policies`)

function quoteIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"'
}
