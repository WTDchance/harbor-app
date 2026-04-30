// Cognito-era stub: legacy service-role client. All callers should be
// ported to lib/aws/db.ts (pool.query). This stub prevents crashes
// during the in-progress migration.
import { supabaseAdmin } from './supabase'
export const supabaseService = supabaseAdmin
export default supabaseAdmin
