// CRUD API for practice settings
// Handles updating practice info, hours, insurance plans, etc.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { Practice } from '@/types'

/**
 * GET /api/practices
 * Get all practices (or filter by ID if ?id=uuid)
 * In a real app, this would be protected to only return the user's practice
 */
export async function GET(request: NextRequest) {
  try {
    const practiceId = request.nextUrl.searchParams.get('id')

    if (practiceId) {
      // Get specific practice
      const { data, error } = await supabaseAdmin
        .from('practices')
        .select('*')
        .eq('id', practiceId)
        .single()

      if (error || !data) {
        return NextResponse.json(
          { error: 'Practice not found' },
          { status: 404 }
        )
      }

      return NextResponse.json(data)
    }

    // Get all practices (should be protected in production)
    const { data, error } = await supabaseAdmin
      .from('practices')
      .select('*')

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching practices:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/practices
 * Create a new practice (signup)
 */
export async function POST(request: NextRequest) {
  try {
    const body: Partial<Practice> = await request.json()
    const { name, ai_name, phone_number, timezone } = body

    if (!name || !phone_number) {
      return NextResponse.json(
        { error: 'Missing required fields: name, phone_number' },
        { status: 400 }
      )
    }

    // Check if phone number already exists
    const { data: existing } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('phone_number', phone_number)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Phone number already in use' },
        { status: 409 }
      )
    }

    // Create practice
    const { data, error } = await supabaseAdmin
      .from('practices')
      .insert({
        name: name,
        ai_name: ai_name || 'Sam',
        phone_number: phone_number,
        timezone: timezone || 'America/Los_Angeles',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating practice:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    console.log(`✓ Practice created: ${data.id}`)

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/practices:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/practices/:id
 * Update practice settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const practiceId = request.nextUrl.searchParams.get('id')

    if (!practiceId) {
      return NextResponse.json(
        { error: 'Missing practice ID' },
        { status: 400 }
      )
    }

    const body = await request.json()

    // Remove immutable fields
    const { id, created_at, stripe_customer_id, stripe_subscription_id, ...updateData } = body

    // Update practice
    const { data, error } = await supabaseAdmin
      .from('practices')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', practiceId)
      .select()
      .single()

    if (error) {
      console.error('Error updating practice:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    console.log(`✓ Practice updated: ${practiceId}`)

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in PATCH /api/practices:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/practices/:id
 * Delete a practice (careful!)
 * This cascades to users, patients, appointments, etc.
 */
export async function DELETE(request: NextRequest) {
  try {
    const practiceId = request.nextUrl.searchParams.get('id')

    if (!practiceId) {
      return NextResponse.json(
        { error: 'Missing practice ID' },
        { status: 400 }
      )
    }

    // Delete practice (cascade handled by database)
    const { error } = await supabaseAdmin
      .from('practices')
      .delete()
      .eq('id', practiceId)

    if (error) {
      console.error('Error deleting practice:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    console.log(`✓ Practice deleted: ${practiceId}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/practices:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
