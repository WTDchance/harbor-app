import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { db, schema } from '@/lib/aws/db'
import { eq, desc, and, gte, lte } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ appointments: [] })

  const fromParam = req.nextUrl.searchParams.get('from')
  const toParam = req.nextUrl.searchParams.get('to')

  const conds = [eq(schema.appointments.practiceId, ctx.practiceId)]
  if (fromParam) conds.push(gte(schema.appointments.scheduledFor, new Date(fromParam)))
  if (toParam) conds.push(lte(schema.appointments.scheduledFor, new Date(toParam)))

  const rows = await db
    .select({
      id: schema.appointments.id,
      patientId: schema.appointments.patientId,
      scheduledFor: schema.appointments.scheduledFor,
      durationMinutes: schema.appointments.durationMinutes,
      appointmentType: schema.appointments.appointmentType,
      status: schema.appointments.status,
      bookedVia: schema.appointments.bookedVia,
      notes: schema.appointments.notes,
      patientFirst: schema.patients.firstName,
      patientLast: schema.patients.lastName,
      patientPreferred: schema.patients.preferredName,
      patientPhone: schema.patients.phone,
    })
    .from(schema.appointments)
    .leftJoin(schema.patients, eq(schema.appointments.patientId, schema.patients.id))
    .where(and(...conds))
    .orderBy(schema.appointments.scheduledFor)
    .limit(200)

  return NextResponse.json({ appointments: rows })
}
